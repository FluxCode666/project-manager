import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { webdavTest, webdavMkdirs, type WebdavConfig } from "@/lib/webdav";

export const runtime = "nodejs";

// GET /api/backup/config —— 读取配置（密码脱敏）
export async function GET() {
  let config = await db.backupConfig.findUnique({ where: { id: "default" } });
  if (!config) {
    config = await db.backupConfig.create({ data: { id: "default" } });
  }
  return NextResponse.json({
    ...config,
    password: config.password ? "********" : null,
    hasPassword: !!config.password,
  });
}

// PUT /api/backup/config —— 保存配置（密码为 "********" 时保留旧值）
// ?test=1 时保存后顺便测试连接
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const existing = await db.backupConfig.findUnique({ where: { id: "default" } });

    const data = {
      enabled: body.enabled ?? existing?.enabled ?? false,
      webdavUrl: body.webdavUrl ?? existing?.webdavUrl ?? null,
      webdavPath: body.webdavPath ?? existing?.webdavPath ?? null,
      username: body.username ?? existing?.username ?? null,
      password:
        body.password && body.password !== "********" ? body.password : existing?.password ?? null,
      retention: body.retention ? Math.max(1, Number(body.retention)) : existing?.retention ?? 14,
      cronEvery: body.cronEvery !== undefined ? Math.max(0, Number(body.cronEvery)) : existing?.cronEvery ?? 24,
    };

    const config = await db.backupConfig.upsert({
      where: { id: "default" },
      update: data,
      create: { id: "default", ...data },
    });

    // 顺带创建远端目录（幂等）
    let testResult: { ok: boolean; message: string } | null = null;
    if (data.enabled && data.webdavUrl && data.username && data.password) {
      const cfg: WebdavConfig = { url: data.webdavUrl, username: data.username, password: data.password };
      testResult = await webdavTest(cfg);
      if (testResult.ok) {
        try {
          await webdavMkdirs(cfg, (data.webdavPath || "/project-manager-backups").replace(/\/+$/, ""));
        } catch (e) {
          testResult = { ok: false, message: `连接成功但建目录失败: ${(e as Error).message}` };
        }
      }
    }

    return NextResponse.json({
      ...config,
      password: config.password ? "********" : null,
      hasPassword: !!config.password,
      testResult,
    });
  } catch (e) {
    return NextResponse.json({ error: "保存失败: " + (e as Error).message }, { status: 500 });
  }
}
