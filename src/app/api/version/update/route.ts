import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { UPDATES_DIR, fetchLatestRelease } from "@/lib/version";

export const runtime = "nodejs";
export const maxDuration = 300;

const execFileAsync = promisify(execFile);

function sh(cmd: string, args: string[], opts?: { cwd?: string; timeout?: number }) {
  return execFileAsync(cmd, args, { timeout: opts?.timeout ?? 120000, ...opts });
}

/**
 * POST /api/version/update —— 自更新流程：
 * 1. 查询最新 release，找到 project-manager-<tag>.tar.gz 及 .sha256
 * 2. 下载并校验 sha256
 * 3. 解压到 /versions/<tag>/，rebuild 原生模块（跨架构兼容）
 * 4. 原子切换 /versions/current 符号链接
 * 5. 响应后退出进程，容器 restart 策略拉起新版本（entrypoint 优先加载 current）
 */
export async function POST() {
  const currentDir = process.cwd();

  // 仅支持 Docker 卷模式（UPDATES_DIR 存在且可写）
  if (!fs.existsSync(UPDATES_DIR)) {
    return NextResponse.json(
      { error: `自更新仅在 Docker 部署模式下可用（未找到 ${UPDATES_DIR}，请挂载 versions 卷）` },
      { status: 400 }
    );
  }

  let release;
  try {
    release = await fetchLatestRelease();
  } catch (e) {
    return NextResponse.json({ error: "查询 release 失败: " + (e as Error).message }, { status: 502 });
  }
  if (!release) return NextResponse.json({ error: "暂无发布版本" }, { status: 404 });

  const tag = release.tag;
  const tarballName = `project-manager-${tag}.tar.gz`;
  const shaName = `${tarballName}.sha256`;
  const tarAsset = release.assets.find((a) => a.name === tarballName);
  const shaAsset = release.assets.find((a) => a.name === shaName);
  if (!tarAsset || !shaAsset) {
    return NextResponse.json(
      { error: `release ${tag} 缺少资产 ${tarballName} / ${shaName}` },
      { status: 404 }
    );
  }

  const headers: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  try {
    // 已是该版本则直接重启（例如修复半途更新）
    const targetDir = path.join(UPDATES_DIR, tag);
    const currentLink = path.join(UPDATES_DIR, "current");

    const alreadyCurrent = (() => {
      try {
        return fs.realpathSync(currentLink) === fs.realpathSync(targetDir);
      } catch {
        return false;
      }
    })();
    if (alreadyCurrent) {
      setTimeout(() => process.exit(0), 500);
      return NextResponse.json({ ok: true, message: `已处于 ${tag}，重启中...` });
    }

    // 1. 下载
    console.log(`[update] 下载 ${tarAsset.url} ...`);
    const [tarRes, shaRes] = await Promise.all([
      fetch(tarAsset.url, { headers }),
      fetch(shaAsset.url, { headers }),
    ]);
    if (!tarRes.ok || !shaRes.ok) throw new Error(`下载失败（tarball ${tarRes.status} / sha256 ${shaRes.status}）`);
    const tarBuf = Buffer.from(await tarRes.arrayBuffer());
    const expectedSha = (await shaRes.text()).trim().split(/\s+/)[0];

    // 2. 校验
    const actualSha = crypto.createHash("sha256").update(tarBuf).digest("hex");
    if (actualSha !== expectedSha) {
      throw new Error(`sha256 校验失败：期望 ${expectedSha}，实际 ${actualSha}`);
    }
    console.log(`[update] sha256 校验通过 (${actualSha.slice(0, 16)}...)`);

    // 3. 解压
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
    const tmpTar = path.join(UPDATES_DIR, tarballName);
    fs.writeFileSync(tmpTar, tarBuf);
    try {
      await sh("tar", ["-xzf", tmpTar, "-C", targetDir]);
    } finally {
      fs.rmSync(tmpTar, { force: true });
    }

    // 4. 原生模块按当前架构重编（发布包可能在异构环境构建）
    const nodeModulesDir = path.join(targetDir, "node_modules");
    if (fs.existsSync(nodeModulesDir)) {
      console.log("[update] rebuild 原生模块...");
      await sh("npm", ["rebuild", "better-sqlite3"], { cwd: targetDir, timeout: 300000 }).catch((e) => {
        console.warn("[update] npm rebuild 警告:", e.message);
      });
    }

    // 校验解压产物
    if (!fs.existsSync(path.join(targetDir, "server.js"))) {
      throw new Error("更新包缺少 server.js，中止");
    }

    // 5. 原子切换 current 符号链接
    const tmpLink = path.join(UPDATES_DIR, "current.tmp");
    fs.rmSync(tmpLink, { force: true });
    fs.symlinkSync(tag, tmpLink);
    fs.renameSync(tmpLink, currentLink);
    console.log(`[update] 已切换 current -> ${tag}，即将重启`);

    // 6. 响应后退出，容器 restart 拉起新版本
    setTimeout(() => process.exit(0), 800);
    return NextResponse.json({ ok: true, message: `已更新到 ${tag}，服务重启中（约 10 秒）...` });
  } catch (e) {
    console.error("[update] 失败:", e);
    return NextResponse.json({ error: "更新失败: " + (e as Error).message }, { status: 500 });
  }
}
