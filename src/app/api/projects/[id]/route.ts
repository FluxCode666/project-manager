import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await db.project.findUnique({
    where: { id },
    include: {
      environments: {
        include: {
          _count: { select: { files: true, targets: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await request.json();
    const existing = await db.project.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const project = await db.project.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        description: body.description ?? existing.description,
        status: body.status ?? existing.status,
        owner: body.owner ?? existing.owner,
        repoUrl: body.repoUrl ?? existing.repoUrl,
        tags: body.tags !== undefined ? (Array.isArray(body.tags) ? body.tags.join(",") : body.tags) : existing.tags,
      },
    });
    return NextResponse.json(project);
  } catch (e) {
    return NextResponse.json({ error: "更新失败: " + (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await db.project.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "删除失败: " + (e as Error).message }, { status: 500 });
  }
}
