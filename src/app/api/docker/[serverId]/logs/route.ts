import { NextRequest, NextResponse } from "next/server";
import { withServerConn } from "@/app/api/nginx/_lib";
import { requireOpsSession } from "@/lib/ops-session";
import {
  DEFAULT_LOG_LINES,
  MAX_LOG_LINES,
  cleanupContainerLogs,
  normalizeContainerId,
  probeDocker,
  readContainerLogs,
  type ContainerLogResult,
  type DockerProbeStatus,
  type LogCleanupResult,
} from "@/lib/docker-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Params = { params: Promise<{ serverId: string }> };

function clampLines(raw: string | null): number {
  const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LOG_LINES;
  return Math.max(1, Math.min(parsed, MAX_LOG_LINES));
}

function probeFailureLog(
  status: DockerProbeStatus,
  message: string,
  containerId: string,
  lines: number,
): ContainerLogResult {
  return {
    status,
    message,
    containerId,
    content: "",
    lineCount: 0,
    lines,
    bytes: 0,
    sizeBytes: null,
    truncated: false,
    truncatedFirstLine: false,
    logPath: null,
    logDriver: null,
    platform: null,
  };
}

function probeFailureCleanup(
  status: DockerProbeStatus,
  message: string,
  containerId: string,
): LogCleanupResult {
  return {
    status,
    message,
    note: "",
    containerId,
    path: null,
    current: null,
    rotated: [],
    rotatedSeen: 0,
    rotatedSkipped: 0,
    durationMs: 0,
  };
}

// GET /api/docker/:serverId/logs?containerId=<64hex>&lines=200 —— 读取所选容器最近日志
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireOpsSession(request);
  if (denied) return denied;
  const { serverId } = await params;
  const containerId = normalizeContainerId(request.nextUrl.searchParams.get("containerId") ?? "");
  const lines = clampLines(request.nextUrl.searchParams.get("lines"));

  if (!containerId) {
    return NextResponse.json({ error: "containerId 必须是完整的 64 位十六进制容器 ID" }, { status: 400 });
  }

  try {
    const result = await withServerConn(serverId, async (conn) => {
      const probe = await probeDocker(conn);
      if (probe.status !== "ok" || !probe.env) {
        return probeFailureLog(probe.status, probe.message, containerId, lines);
      }
      return readContainerLogs(conn, probe.env, containerId, lines);
    });
    return NextResponse.json(result);
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes("服务器不存在")) {
      return NextResponse.json({ error: "服务器不存在" }, { status: 404 });
    }
    return NextResponse.json({ error: "读取容器日志失败: " + message }, { status: 500 });
  }
}

// POST /api/docker/:serverId/logs —— 清空所选容器（仅已停止、json-file）的日志文件
// body: { containerId: "<64hex>" }
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireOpsSession(request);
  if (denied) return denied;
  const { serverId } = await params;
  const body = await request.json().catch(() => ({}));
  const containerId = normalizeContainerId(typeof body?.containerId === "string" ? body.containerId : "");

  if (!containerId) {
    return NextResponse.json({ error: "containerId 必须是完整的 64 位十六进制容器 ID" }, { status: 400 });
  }

  try {
    const result = await withServerConn(serverId, async (conn) => {
      const probe = await probeDocker(conn);
      if (probe.status !== "ok" || !probe.env) {
        return probeFailureCleanup(probe.status, probe.message, containerId);
      }
      return cleanupContainerLogs(conn, probe.env, containerId);
    });

    console.log(
      `[docker] cleanup server=${serverId} container=${containerId} status=${result.status} files=${result.current ? 1 + result.rotated.length : 0}`,
    );
    return NextResponse.json(result);
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes("服务器不存在")) {
      return NextResponse.json({ error: "服务器不存在" }, { status: 404 });
    }
    return NextResponse.json({ error: "清理容器日志失败: " + message }, { status: 500 });
  }
}
