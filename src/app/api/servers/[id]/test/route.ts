import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sshTestConnection } from "@/lib/ssh";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const server = await db.server.findUnique({ where: { id } });
  if (!server) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (server.sshAuthType === "password" && !server.sshPassword) {
    return NextResponse.json({ ok: false, message: "未配置 SSH 密码" });
  }
  if (server.sshAuthType === "privateKey" && !server.sshPrivateKey) {
    return NextResponse.json({ ok: false, message: "未配置 SSH 私钥" });
  }

  const result = await sshTestConnection({
    host: server.host,
    port: server.port,
    sshUser: server.sshUser,
    sshAuthType: server.sshAuthType,
    sshPassword: server.sshPassword,
    sshPrivateKey: server.sshPrivateKey,
  });

  // 根据测试结果更新服务器状态
  await db.server.update({
    where: { id },
    data: { status: result.ok ? "online" : "offline" },
  });

  return NextResponse.json(result);
}
