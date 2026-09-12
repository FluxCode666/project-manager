import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1));
  const pageSize = 20;

  const [logs, total] = await Promise.all([
    db.syncLog.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        deployTarget: { include: { server: true, environment: { include: { project: true } } } },
      },
    }),
    db.syncLog.count(),
  ]);

  return NextResponse.json({ logs, total, page, pageSize });
}
