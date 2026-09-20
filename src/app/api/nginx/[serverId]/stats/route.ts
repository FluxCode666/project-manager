import { NextRequest, NextResponse } from "next/server";
import { withServerConn } from "@/app/api/nginx/_lib";
import { nginxStats } from "@/lib/nginx";

export const runtime = "nodejs";

type Params = { params: Promise<{ serverId: string }> };

// 访问统计：解析 access.log 尾部 N 行（默认 10000）
export async function GET(request: NextRequest, { params }: Params) {
  const { serverId } = await params;
  const linesParam = request.nextUrl.searchParams.get("lines");
  const lines = Math.max(100, Math.min(parseInt(linesParam ?? "10000", 10) || 10000, 100000));

  try {
    const stats = await withServerConn(serverId, (conn) => nginxStats(conn, lines));
    return NextResponse.json(stats);
  } catch (e) {
    return NextResponse.json({ error: "统计失败: " + (e as Error).message }, { status: 500 });
  }
}
