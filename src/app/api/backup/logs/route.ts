import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listRemoteBackups } from "@/lib/backup";

export const runtime = "nodejs";

// GET /api/backup/logs —— 备份记录 + 远端现有备份列表
export async function GET(request: NextRequest) {
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1));
  const pageSize = 15;

  const [logs, total, remote] = await Promise.all([
    db.backupLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.backupLog.count(),
    listRemoteBackups().catch(() => null),
  ]);

  return NextResponse.json({ logs, total, page, pageSize, remote });
}
