import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sshConnect, sshExec, sftpWriteFile, sftpReadFile } from "@/lib/ssh";
import type { Client } from "ssh2";

export const runtime = "nodejs";

interface MergedFile {
  filename: string;
  content: string;
  source: "env" | "target";
}

async function buildMergedFiles(environmentId: string, targetId: string | null): Promise<MergedFile[]> {
  // 合并规则：环境级文件 + 目标级专属文件（同名时目标级覆盖）
  const [envFiles, targetFiles] = await Promise.all([
    db.envFile.findMany({ where: { environmentId } }),
    targetId
      ? db.targetFile.findMany({ where: { deployTargetId: targetId } })
      : [],
  ]);

  const map = new Map<string, MergedFile>();
  for (const f of envFiles) map.set(f.filename, { filename: f.filename, content: f.content, source: "env" });
  for (const f of targetFiles) map.set(f.filename, { filename: f.filename, content: f.content, source: "target" });
  return Array.from(map.values());
}

interface SyncResult {
  targetId: string;
  serverName: string;
  status: "success" | "failed";
  filesSynced: number;
  files: { filename: string; status: "synced" | "skipped" | "failed"; source: string }[];
  commandOutput?: string;
  errorMessage?: string;
  durationMs: number;
}

async function syncOneTarget(targetId: string, command?: string): Promise<SyncResult> {
  const start = Date.now();
  const target = await db.deployTarget.findUnique({
    where: { id: targetId },
    include: { server: true, environment: true },
  });

  const fail = async (message: string, filesSynced = 0, files: SyncResult["files"] = []): Promise<SyncResult> => {
    const result: SyncResult = {
      targetId,
      serverName: target?.server.name ?? "unknown",
      status: "failed",
      filesSynced,
      files,
      errorMessage: message,
      durationMs: Date.now() - start,
    };
    await db.syncLog.create({
      data: {
        deployTargetId: targetId,
        status: "failed",
        filesSynced,
        commandExecuted: command ?? null,
        errorMessage: message,
        durationMs: result.durationMs,
      },
    });
    return result;
  };

  if (!target) return fail("部署目标不存在");
  if (!target.enabled) return fail("该目标已停用");
  const { server, environment } = target;

  if (server.sshAuthType === "password" && !server.sshPassword) return fail("服务器未配置 SSH 密码");
  if (server.sshAuthType === "privateKey" && !server.sshPrivateKey) return fail("服务器未配置 SSH 私钥");

  let conn: Client;
  try {
    conn = await sshConnect({
      host: server.host,
      port: server.port,
      sshUser: server.sshUser,
      sshAuthType: server.sshAuthType,
      sshPassword: server.sshPassword,
      sshPrivateKey: server.sshPrivateKey,
    });
  } catch (e) {
    return fail(`SSH 连接失败: ${(e as Error).message}`);
  }

  try {
    const files = await buildMergedFiles(environment.id, targetId);
    if (files.length === 0) {
      conn.end();
      return fail("没有可同步的文件（环境级和目标级均为空）");
    }

    // mkdir -p 部署目录
    await sshExec(conn, `mkdir -p ${JSON.stringify(environment.deployPath)}`);

    const fileResults: SyncResult["files"] = [];
    let synced = 0;
    for (const f of files) {
      const remotePath = `${environment.deployPath.replace(/\/+$/, "")}/${f.filename}`;
      try {
        await sftpWriteFile(conn, remotePath, f.content);
        fileResults.push({ filename: f.filename, status: "synced", source: f.source });
        synced++;
      } catch (e) {
        fileResults.push({ filename: f.filename, status: "failed", source: f.source });
        conn.end();
        return fail(`写入文件 ${f.filename} 失败: ${(e as Error).message}`, synced, fileResults);
      }
    }

    // 可选：执行部署命令（如 docker compose up -d）
    let commandOutput = "";
    if (command && command.trim()) {
      const fullCommand = `cd ${JSON.stringify(environment.deployPath)} && ${command}`;
      const execResult = await sshExec(conn, fullCommand, 120000);
      commandOutput = [
        execResult.stdout ? `stdout:\n${execResult.stdout}` : "",
        execResult.stderr ? `stderr:\n${execResult.stderr}` : "",
        `exit code: ${execResult.code}`,
      ]
        .filter(Boolean)
        .join("\n");
      if (execResult.code !== 0) {
        conn.end();
        return fail(`部署命令执行失败（exit ${execResult.code}）\n${commandOutput}`, synced, fileResults);
      }
    }

    conn.end();
    const durationMs = Date.now() - start;
    await db.syncLog.create({
      data: {
        deployTargetId: targetId,
        status: "success",
        filesSynced: synced,
        commandExecuted: command ?? null,
        output: commandOutput || null,
        durationMs,
      },
    });
    return {
      targetId,
      serverName: server.name,
      status: "success",
      filesSynced: synced,
      files: fileResults,
      commandOutput: commandOutput || undefined,
      durationMs,
    };
  } catch (e) {
    try {
      conn.end();
    } catch {}
    return fail(`同步失败: ${(e as Error).message}`);
  }
}

// POST /api/sync
// { deployTargetId } 或 { environmentId, command? } —— 后者同步该环境所有启用目标
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const command = body.command as string | undefined;

    let targetIds: string[] = [];
    if (body.deployTargetId) {
      targetIds = [body.deployTargetId];
    } else if (body.environmentId) {
      const targets = await db.deployTarget.findMany({
        where: { environmentId: body.environmentId, enabled: true },
        select: { id: true },
      });
      targetIds = targets.map((t) => t.id);
    } else {
      return NextResponse.json({ error: "需要 deployTargetId 或 environmentId" }, { status: 400 });
    }

    if (targetIds.length === 0) {
      return NextResponse.json({ results: [], message: "没有启用中的部署目标" });
    }

    const results: SyncResult[] = [];
    for (const tid of targetIds) {
      results.push(await syncOneTarget(tid, command));
    }
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: "同步请求失败: " + (e as Error).message }, { status: 500 });
  }
}

// GET /api/sync?deployTargetId=...&filename=...
// 拉取服务器上的现有文件内容（用于对比 / 回填编辑器）
export async function GET(request: NextRequest) {
  const deployTargetId = request.nextUrl.searchParams.get("deployTargetId");
  const filename = request.nextUrl.searchParams.get("filename");
  if (!deployTargetId || !filename) {
    return NextResponse.json({ error: "deployTargetId 和 filename 为必填项" }, { status: 400 });
  }

  const target = await db.deployTarget.findUnique({
    where: { id: deployTargetId },
    include: { server: true, environment: true },
  });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const conn = await sshConnect({
      host: target.server.host,
      port: target.server.port,
      sshUser: target.server.sshUser,
      sshAuthType: target.server.sshAuthType,
      sshPassword: target.server.sshPassword,
      sshPrivateKey: target.server.sshPrivateKey,
    });
    const remotePath = `${target.environment.deployPath.replace(/\/+$/, "")}/${filename}`;
    const content = await sftpReadFile(conn, remotePath);
    conn.end();
    return NextResponse.json({ exists: content !== null, content });
  } catch (e) {
    return NextResponse.json({ error: "拉取失败: " + (e as Error).message }, { status: 500 });
  }
}
