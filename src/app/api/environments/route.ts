import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.projectId || !body.name || !body.deployPath) {
      return NextResponse.json({ error: "项目、环境名称和部署目录为必填项" }, { status: 400 });
    }
    const dup = await db.environment.findFirst({
      where: { projectId: body.projectId, name: body.name },
    });
    if (dup) {
      return NextResponse.json({ error: `环境「${body.name}」已存在` }, { status: 400 });
    }
    const env = await db.environment.create({
      data: {
        projectId: body.projectId,
        name: body.name,
        deployPath: body.deployPath,
        description: body.description || null,
      },
    });
    return NextResponse.json(env, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "创建失败: " + (e as Error).message }, { status: 500 });
  }
}
