import fs from "fs";
import path from "path";

export const UPDATES_DIR = process.env.UPDATES_DIR || "/versions";

/** 当前运行版本：读取应用根目录的 VERSION 文件（镜像构建 / 发版打包时写入） */
export function getCurrentVersion(): string {
  try {
    return fs.readFileSync(path.join(process.cwd(), "VERSION"), "utf8").trim();
  } catch {
    return "dev";
  }
}

export function getGithubRepo(): string | null {
  return process.env.GITHUB_REPO || null; // 形如 "fluxcode666/project-manager"
}

export interface ReleaseInfo {
  tag: string;
  name: string | null;
  publishedAt: string | null;
  htmlUrl: string;
  body: string | null;
  assets: { name: string; url: string; size: number }[];
}

export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  const repo = getGithubRepo();
  if (!repo) return null;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "project-manager",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    if (res.status === 404) return null; // 还没有 release
    throw new Error(`GitHub API ${res.status}`);
  }
  const data = (await res.json()) as {
    tag_name: string;
    name: string | null;
    published_at: string | null;
    html_url: string;
    body: string | null;
    assets: { name: string; browser_download_url: string; size: number }[];
  };

  return {
    tag: data.tag_name,
    name: data.name,
    publishedAt: data.published_at,
    htmlUrl: data.html_url,
    body: data.body,
    assets: data.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
  };
}

/** 比较版本号（v1.2.3 格式），latest > current 返回 true */
export function isNewerVersion(latest: string, current: string): boolean {
  const norm = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  if (current === "dev") return true;
  const l = norm(latest);
  const c = norm(current);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}
