import { NextResponse } from "next/server";
import { withServerConn } from "@/app/api/nginx/_lib";
import { nginxStatus, nginxTestConfig, nginxReload } from "@/lib/nginx";

export const runtime = "nodejs";

type Params = { params: Promise<{ serverId: string }> };

// 概览：版本 / 运行状态 / 配置校验 / 进程列表
export async function GET(_request: Request, { params }: Params) {
  const { serverId } = await params;
  try {
    const status = await withServerConn(serverId, (conn) => nginxStatus(conn));
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json({ error: "获取 nginx 状态失败: " + (e as Error).message }, { status: 500 });
  }
}

// 校验配置并重载
export async function POST(_request: Request, { params }: Params) {
  const { serverId } = await params;
  try {
    const result = await withServerConn(serverId, async (conn) => {
      const test = await nginxTestConfig(conn);
      if (!test.ok) return { ok: false, stage: "test", output: test.output };
      const reload = await nginxReload(conn);
      return { ok: reload.ok, stage: "reload", output: reload.output };
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "重载失败: " + (e as Error).message }, { status: 500 });
  }
}
