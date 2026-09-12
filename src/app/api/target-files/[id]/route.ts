import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await request.json();
    const existing = await db.targetFile.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const file = await db.targetFile.update({
      where: { id },
      data: { content: body.content ?? existing.content },
    });
    return NextResponse.json(file);
  } catch (e) {
    return NextResponse.json({ error: "更新失败: " + (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await db.targetFile.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "删除失败: " + (e as Error).message }, { status: 500 });
  }
}
