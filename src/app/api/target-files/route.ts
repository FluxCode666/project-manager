import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// 目标级专属文件（如每台服务器各自的 .env）
// POST { deployTargetId, filename, content? }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.deployTargetId || !body.filename) {
      return NextResponse.json({ error: "部署目标和文件名为必填项" }, { status: 400 });
    }
    if (body.filename.includes("/")) {
      return NextResponse.json({ error: "文件名不能包含路径分隔符" }, { status: 400 });
    }
    const dup = await db.targetFile.findFirst({
      where: { deployTargetId: body.deployTargetId, filename: body.filename },
    });
    if (dup) return NextResponse.json({ error: `文件「${body.filename}」已存在` }, { status: 400 });

    const file = await db.targetFile.create({
      data: {
        deployTargetId: body.deployTargetId,
        filename: body.filename,
        content: body.content ?? "",
      },
    });
    return NextResponse.json(file, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "创建失败: " + (e as Error).message }, { status: 500 });
  }
}
