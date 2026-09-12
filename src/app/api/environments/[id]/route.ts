import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const env = await db.environment.findUnique({
    where: { id },
    include: {
      project: true,
      files: true,
      targets: {
        include: {
          server: true,
          files: true,
          syncLogs: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!env) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(env);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await request.json();
    const existing = await db.environment.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    if (body.name && body.name !== existing.name) {
      const dup = await db.environment.findFirst({
        where: { projectId: existing.projectId, name: body.name, NOT: { id } },
      });
      if (dup) return NextResponse.json({ error: `环境「${body.name}」已存在` }, { status: 400 });
    }

    const env = await db.environment.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        deployPath: body.deployPath ?? existing.deployPath,
        description: body.description ?? existing.description,
      },
    });
    return NextResponse.json(env);
  } catch (e) {
    return NextResponse.json({ error: "更新失败: " + (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await db.environment.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "删除失败: " + (e as Error).message }, { status: 500 });
  }
}
