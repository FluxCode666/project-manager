import { NextRequest, NextResponse } from "next/server";
import type { Client } from "ssh2";
import { db } from "@/lib/db";
import { sshConnect, sshExec } from "@/lib/ssh";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// 探测操作系统信息：优先 lsb_release / os-release（发行版名+版本），补上架构
async function detectOs(conn: Client): Promise<string> {
  const { stdout } = await sshExec(
    conn,
    `(lsb_release -ds 2>/dev/null || cat /etc/os-release 2>/dev/null | grep '^PRETTY_NAME' | cut -d'"' -f2) ; uname -m`
  );
  const lines = stdout.trim().split("\n").filter(Boolean);
  const name = lines[0] || "";
  const arch = lines[1] || "";
  return [name, arch].filter(Boolean).join(" ").slice(0, 200);
}

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

  let conn;
  try {
    conn = await sshConnect({
      host: server.host,
      port: server.port,
      sshUser: server.sshUser,
      sshAuthType: server.sshAuthType,
      sshPassword: server.sshPassword,
      sshPrivateKey: server.sshPrivateKey,
    });
  } catch (err) {
    await db.server.update({ where: { id }, data: { status: "offline" } });
    return NextResponse.json({ ok: false, message: (err as Error).message || "连接失败" });
  }

  try {
    const os = await detectOs(conn);
    conn.end();
    await db.server.update({ where: { id }, data: { status: "online", os: os || server.os } });
    return NextResponse.json({ ok: true, message: os ? `连接成功 · ${os}` : "连接成功" });
  } catch (err) {
    conn.end();
    await db.server.update({ where: { id }, data: { status: "online" } });
    return NextResponse.json({ ok: true, message: "连接成功（系统信息探测失败）: " + (err as Error).message });
  }
}
