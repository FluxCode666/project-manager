import { NextRequest, NextResponse } from "next/server";
import { withServerConn } from "@/app/api/nginx/_lib";
import { nginxListLogs, nginxTailLog } from "@/lib/nginx";

export const runtime = "nodejs";

type Params = { params: Promise<{ serverId: string }> };

// 日志：?file=access.log&lines=200 读取尾部；不带 file 则列出日志文件
export async function GET(request: NextRequest, { params }: Params) {
  const { serverId } = await params;
  const file = request.nextUrl.searchParams.get("file");
  const linesParam = request.nextUrl.searchParams.get("lines");

  try {
    if (file) {
      const lines = Math.max(1, Math.min(parseInt(linesParam ?? "200", 10) || 200, 5000));
      const content = await withServerConn(serverId, (conn) => nginxTailLog(conn, file, lines));
      return NextResponse.json({ file, lines, content });
    }
    const files = await withServerConn(serverId, (conn) => nginxListLogs(conn));
    return NextResponse.json({ files });
  } catch (e) {
    return NextResponse.json({ error: "读取日志失败: " + (e as Error).message }, { status: 500 });
  }
}
