import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const server = await db.server.findUnique({
    where: { id },
    include: {
      targets: {
        include: {
          environment: { include: { project: true } },
          _count: { select: { files: true } },
        },
      },
    },
  });
  if (!server) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(server);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await request.json();
    const existing = await db.server.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const server = await db.server.update({
      where: { id },
      data: {
        name: body.name ?? existing.name,
        host: body.host ?? existing.host,
        port: body.port ? Number(body.port) : existing.port,
        sshUser: body.sshUser ?? existing.sshUser,
        sshAuthType: body.sshAuthType ?? existing.sshAuthType,
        // 凭据为空时不覆盖已有值
        sshPassword: body.sshPassword !== undefined && body.sshPassword !== "" ? body.sshPassword : existing.sshPassword,
        sshPrivateKey:
          body.sshPrivateKey !== undefined && body.sshPrivateKey !== ""
            ? body.sshPrivateKey
            : existing.sshPrivateKey,
        os: body.os ?? existing.os,
        provider: body.provider ?? existing.provider,
        notes: body.notes ?? existing.notes,
        status: body.status ?? existing.status,
      },
    });
    return NextResponse.json(server);
  } catch (e) {
    return NextResponse.json({ error: "更新失败: " + (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await db.server.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "删除失败: " + (e as Error).message }, { status: 500 });
  }
}
