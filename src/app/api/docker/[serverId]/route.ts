import { NextRequest, NextResponse } from "next/server";
import { withServerConn } from "@/app/api/nginx/_lib";
import { requireOpsSession } from "@/lib/ops-session";
import {
  listContainers,
  probeDocker,
  type DockerContainer,
  type DockerEnvInfo,
} from "@/lib/docker-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ serverId: string }> };

interface DockerListPayload {
  status: string;
  message: string;
  env: DockerEnvInfo | null;
  containers: DockerContainer[];
  total: number;
  truncated: boolean;
  parseErrors: number;
}

// GET /api/docker/:serverId —— 通过服务器保存的 SSH 凭据列出本机 Docker 容器（含已停止）
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireOpsSession(request);
  if (denied) return denied;
  const { serverId } = await params;

  try {
    const payload = await withServerConn(serverId, async (conn): Promise<DockerListPayload> => {
      const probe = await probeDocker(conn);
      if (probe.status !== "ok" || !probe.env) {
        return {
          status: probe.status,
          message: probe.message,
          env: probe.env,
          containers: [],
          total: 0,
          truncated: false,
          parseErrors: 0,
        };
      }

      const list = await listContainers(conn, probe.env);
      if (list.status === "failed") {
        return {
          status: "daemon_error",
          message: list.message,
          env: probe.env,
          containers: [],
          total: 0,
          truncated: list.truncated,
          parseErrors: list.parseErrors,
        };
      }

      return {
        status: list.status,
        message: list.message,
        env: probe.env,
        containers: list.containers,
        total: list.containers.length,
        truncated: list.truncated,
        parseErrors: list.parseErrors,
      };
    });

    return NextResponse.json(payload);
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes("服务器不存在")) {
      return NextResponse.json({ error: "服务器不存在" }, { status: 404 });
    }
    return NextResponse.json({ error: "获取 Docker 容器失败: " + message }, { status: 500 });
  }
}
