import { db } from "@/lib/db";
import { sshConnect } from "@/lib/ssh";
import type { Client } from "ssh2";
import type { Server } from "@/generated/prisma/client";

export const runtime = "nodejs";

// 加载服务器资产
export async function loadServer(serverId: string): Promise<Server | null> {
  return db.server.findUnique({ where: { id: serverId } });
}

// 校验凭据
export function assertSshCredentials(server: Server): void {
  if (server.sshAuthType === "password" && !server.sshPassword) {
    throw new Error("服务器未配置 SSH 密码");
  }
  if (server.sshAuthType === "privateKey" && !server.sshPrivateKey) {
    throw new Error("服务器未配置 SSH 私钥");
  }
}

// 连接 SSH
export async function connect(server: Server): Promise<Client> {
  assertSshCredentials(server);
  try {
    return await sshConnect({
      host: server.host,
      port: server.port,
      sshUser: server.sshUser,
      sshAuthType: server.sshAuthType,
      sshPassword: server.sshPassword,
      sshPrivateKey: server.sshPrivateKey,
    });
  } catch (e) {
    throw new Error("SSH 连接失败: " + (e as Error).message);
  }
}

// 加载服务器 + 连接 + 执行 + 自动关闭连接
export async function withServerConn<T>(
  serverId: string,
  fn: (conn: Client) => Promise<T>,
): Promise<T> {
  const server = await loadServer(serverId);
  if (!server) throw new Error("服务器不存在");
  const conn = await connect(server);
  try {
    return await fn(conn);
  } finally {
    try {
      conn.end();
    } catch {}
  }
}
