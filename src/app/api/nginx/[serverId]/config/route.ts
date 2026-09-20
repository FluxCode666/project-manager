import { NextResponse } from "next/server";
import { withServerConn } from "@/app/api/nginx/_lib";
import { nginxReadMainConfig } from "@/lib/nginx";

export const runtime = "nodejs";

type Params = { params: Promise<{ serverId: string }> };

// 读取主配置 /etc/nginx/nginx.conf（只读视图）
export async function GET(_request: Request, { params }: Params) {
  const { serverId } = await params;
  try {
    const content = await withServerConn(serverId, (conn) => nginxReadMainConfig(conn));
    if (content == null) {
      return NextResponse.json({ error: "无法读取 /etc/nginx/nginx.conf（文件可能不存在或权限不足）" }, { status: 404 });
    }
    return NextResponse.json({ content });
  } catch (e) {
    return NextResponse.json({ error: "读取主配置失败: " + (e as Error).message }, { status: 500 });
  }
}
