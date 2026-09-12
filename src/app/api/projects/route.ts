import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const projects = await db.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { environments: true } } },
  });
  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: "项目名称为必填项" }, { status: 400 });
    }
    // slug 自动生成：未提供时从名称转写，冲突时追加随机后缀
    let slug = (body.slug || body.name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!slug) slug = "project";
    const exists = await db.project.findUnique({ where: { slug } });
    if (exists) slug = `${slug}-${Date.now().toString(36)}`;

    const project = await db.project.create({
      data: {
        name: body.name,
        slug,
        description: body.description || null,
        status: body.status || "active",
        owner: body.owner || null,
        repoUrl: body.repoUrl || null,
        tags: Array.isArray(body.tags) ? body.tags.join(",") : body.tags || null,
      },
    });
    return NextResponse.json(project, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "创建失败: " + (e as Error).message }, { status: 500 });
  }
}
