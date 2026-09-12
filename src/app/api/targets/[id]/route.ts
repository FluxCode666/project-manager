import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// PATCH: 启用/停用目标
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await request.json();
    const target = await db.deployTarget.update({
      where: { id },
      data: { enabled: body.enabled },
    });
    return NextResponse.json(target);
  } catch (e) {
    return NextResponse.json({ error: "更新失败: " + (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await db.deployTarget.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "删除失败: " + (e as Error).message }, { status: 500 });
  }
}
