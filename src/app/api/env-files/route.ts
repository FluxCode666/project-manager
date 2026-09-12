import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// 环境级共享文件 CRUD（POST 创建；PUT/DELETE 走 [id]）

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.environmentId || !body.filename) {
      return NextResponse.json({ error: "环境和文件名为必填项" }, { status: 400 });
    }
    if (body.filename.includes("/")) {
      return NextResponse.json({ error: "文件名不能包含路径分隔符" }, { status: 400 });
    }
    const dup = await db.envFile.findFirst({
      where: { environmentId: body.environmentId, filename: body.filename },
    });
    if (dup) return NextResponse.json({ error: `文件「${body.filename}」已存在` }, { status: 400 });

    const file = await db.envFile.create({
      data: {
        environmentId: body.environmentId,
        filename: body.filename,
        content: body.content ?? "",
      },
    });
    return NextResponse.json(file, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "创建失败: " + (e as Error).message }, { status: 500 });
  }
}
