import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const servers = await db.server.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { targets: true } } },
  });
  return NextResponse.json(servers);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.name || !body.host) {
      return NextResponse.json({ error: "名称和主机地址为必填项" }, { status: 400 });
    }
    const server = await db.server.create({
      data: {
        name: body.name,
        host: body.host,
        port: body.port ? Number(body.port) : 22,
        sshUser: body.sshUser || "root",
        sshAuthType: body.sshAuthType || "password",
        sshPassword: body.sshPassword || null,
        sshPrivateKey: body.sshPrivateKey || null,
        os: body.os || null,
        provider: body.provider || null,
        notes: body.notes || null,
        status: body.status || "online",
      },
    });
    return NextResponse.json(server, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "创建失败: " + (e as Error).message }, { status: 500 });
  }
}
