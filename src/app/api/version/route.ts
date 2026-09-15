import { NextResponse } from "next/server";
import {
  UPDATES_DIR,
  getCurrentVersion,
  getGithubRepo,
  fetchLatestRelease,
  isNewerVersion,
} from "@/lib/version";

export const runtime = "nodejs";

/** 去掉 GitHub 自动生成 release notes 末尾的 "**Full Changelog**: ..." 链接行 */
function stripFullChangelog(body: string | null): string | null {
  if (!body) return body;
  const cleaned = body
    .split("\n")
    .filter((line) => !/^\s*(\*\*)?full changelog/i.test(line))
    .join("\n")
    .trim();
  return cleaned || null;
}

// GET /api/version —— 当前版本 + 最新 release 信息
export async function GET() {
  const current = getCurrentVersion();
  const repo = getGithubRepo();

  if (!repo) {
    return NextResponse.json({
      current,
      latest: null,
      hasUpdate: false,
      message: "未配置 GITHUB_REPO 环境变量，无法检查更新",
    });
  }

  try {
    const release = await fetchLatestRelease();
    if (!release) {
      return NextResponse.json({ current, latest: null, hasUpdate: false, message: "暂无发布版本" });
    }
    return NextResponse.json({
      current,
      latest: {
        tag: release.tag,
        name: release.name,
        publishedAt: release.publishedAt,
        htmlUrl: release.htmlUrl,
        notes: stripFullChangelog(release.body),
      },
      hasUpdate: isNewerVersion(release.tag, current),
    });
  } catch (e) {
    return NextResponse.json({
      current,
      latest: null,
      hasUpdate: false,
      message: "检查更新失败: " + (e as Error).message,
    });
  }
}

// HEAD /api/version —— 重启后的存活探测（轻量）
export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}

// POST /api/version —— 仅检查 UPDATES_DIR 是否可用于自更新（供前端预检）
export async function POST() {
  const canUpdate = (() => {
    try {
      const fs = require("fs") as typeof import("fs");
      return fs.existsSync(UPDATES_DIR) && fs.statSync(UPDATES_DIR).isDirectory();
    } catch {
      return false;
    }
  })();
  return NextResponse.json({ canUpdate, updatesDir: UPDATES_DIR });
}
