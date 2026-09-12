import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// 部署目标：环境绑定服务器
// POST { environmentId, serverId, notes? }  绑定
// GET  ?environmentId=...                    该环境的目标列表

export async function GET(request: NextRequest) {
  const environmentId = request.nextUrl.searchParams.get("environmentId");
  if (!environmentId) return NextResponse.json({ error: "environmentId required" }, { status: 400 });
  const targets = await db.deployTarget.findMany({
    where: { environmentId },
    include: {
      server: true,
      files: true,
      syncLogs: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  return NextResponse.json(targets);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.environmentId || !body.serverId) {
      return NextResponse.json({ error: "环境和服务器为必填项" }, { status: 400 });
    }
    const dup = await db.deployTarget.findFirst({
      where: { environmentId: body.environmentId, serverId: body.serverId },
    });
    if (dup) return NextResponse.json({ error: "该服务器已绑定到此环境" }, { status: 400 });

    const target = await db.deployTarget.create({
      data: {
        environmentId: body.environmentId,
        serverId: body.serverId,
        notes: body.notes || null,
      },
      include: { server: true },
    });
    return NextResponse.json(target, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "创建失败: " + (e as Error).message }, { status: 500 });
  }
}
