import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import zlib from "zlib";
import Database from "better-sqlite3";
import { db } from "@/lib/db";
import { webdavPut, webdavMkdirs, webdavList, webdavDelete, type WebdavConfig } from "@/lib/webdav";

const BACKUP_PREFIX = "project-manager";

/** 从 DATABASE_URL 解析 SQLite 文件路径 */
function resolveDbFile(): string {
  const url = process.env.DATABASE_URL!;
  return url.replace(/^file:/, "").replace(/\?.*$/, "");
}

export interface BackupResult {
  ok: boolean;
  fileName?: string;
  fileSize?: number;
  remoteUrl?: string;
  durationMs: number;
  error?: string;
}

/**
 * 执行一次备份：
 * 1. VACUUM INTO 生成一致性快照（不受写入并发影响，比直接复制 db 文件安全）
 * 2. gzip 压缩 + sha256 命名（内容寻址，避免文件名冲突）
 * 3. 上传 WebDAV（自动建目录）
 * 4. 按 retention 清理超出保留数的旧备份（只清理本系统命名规则的文件）
 */
export async function runBackup(trigger: "manual" | "scheduled"): Promise<BackupResult> {
  const start = Date.now();
  const config = await db.backupConfig.findUnique({ where: { id: "default" } });

  const fail = async (error: string): Promise<BackupResult> => {
    await db.backupLog.create({
      data: { trigger, status: "failed", errorMessage: error, durationMs: Date.now() - start },
    });
    return { ok: false, error, durationMs: Date.now() - start };
  };

  if (!config?.enabled) return fail("备份未启用");
  if (!config.webdavUrl || !config.username || !config.password) return fail("WebDAV 配置不完整");

  const cfg: WebdavConfig = {
    url: config.webdavUrl,
    username: config.username,
    password: config.password,
  };
  const remoteDir = (config.webdavPath || "/project-manager-backups").replace(/\/+$/, "");

  // 1. VACUUM INTO 快照
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-backup-"));
  const dbFile = resolveDbFile();
  let snapshotPath: string;
  let gzPath: string;
  let fileName: string;

  try {
    if (!fs.existsSync(dbFile)) return fail(`数据库文件不存在: ${dbFile}`);

    snapshotPath = path.join(tmpDir, "snapshot.db");
    const src = new Database(dbFile, { readonly: true });
    try {
      src.exec(`VACUUM INTO '${snapshotPath.replace(/'/g, "''")}'`);
    } finally {
      src.close();
    }

    // 2. gzip + sha256
    const raw = fs.readFileSync(snapshotPath);
    const gz = zlib.gzipSync(raw, { level: 6 });
    const sha = crypto.createHash("sha256").update(gz).digest("hex").slice(0, 12);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    fileName = `${BACKUP_PREFIX}-${stamp}-${sha}.db.gz`;
    gzPath = path.join(tmpDir, fileName);
    fs.writeFileSync(gzPath, gz);

    // 3. 上传
    await webdavMkdirs(cfg, remoteDir);
    const remoteFile = `${remoteDir}/${fileName}`;
    await webdavPut(cfg, remoteFile, gz, "application/gzip");

    // 4. 清理超出保留数的旧备份
    const retention = Math.max(1, config.retention);
    try {
      const files = await webdavList(cfg, remoteDir);
      const mine = files
        .filter((f) => f.name.startsWith(`${BACKUP_PREFIX}-`) && f.name.endsWith(".db.gz") && f.name !== fileName)
        .sort((a, b) => a.name.localeCompare(b.name)); // 时间戳命名，字典序即时间序
      const toDelete = mine.slice(0, Math.max(0, mine.length - (retention - 1)));
      for (const f of toDelete) {
        await webdavDelete(cfg, `${remoteDir}/${f.name}`);
      }
    } catch (e) {
      // 清理失败不影响备份结果
      console.warn("[backup] 清理旧备份失败:", e);
    }

    await db.backupLog.create({
      data: {
        trigger,
        status: "success",
        fileName,
        fileSize: gz.length,
        remoteUrl: remoteFile,
        durationMs: Date.now() - start,
      },
    });
    await db.backupConfig.update({ where: { id: "default" }, data: { lastRunAt: new Date() } });

    return { ok: true, fileName, fileSize: gz.length, remoteUrl: remoteFile, durationMs: Date.now() - start };
  } catch (e) {
    return fail(`备份失败: ${(e as Error).message}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** 列出 WebDAV 上的现有备份文件 */
export async function listRemoteBackups() {
  const config = await db.backupConfig.findUnique({ where: { id: "default" } });
  if (!config?.enabled || !config.webdavUrl || !config.username || !config.password) {
    return null;
  }
  const cfg: WebdavConfig = { url: config.webdavUrl, username: config.username, password: config.password };
  const remoteDir = (config.webdavPath || "/project-manager-backups").replace(/\/+$/, "");
  const files = await webdavList(cfg, remoteDir);
  return files
    .filter((f) => f.name.startsWith(`${BACKUP_PREFIX}-`) && f.name.endsWith(".db.gz"))
    .sort((a, b) => b.name.localeCompare(a.name));
}
