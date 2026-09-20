import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withServerConn } from "@/app/api/nginx/_lib";
import { nginxWriteSite, nginxTestConfig, nginxReload } from "@/lib/nginx";

export const runtime = "nodejs";

type Params = { params: Promise<{ serverId: string }> };

// 将数据库中所有站点配置同步到服务器，校验并重载
export async function POST(_request: Request, { params }: Params) {
  const { serverId } = await params;
  try {
    const sites = await db.nginxSite.findMany({ where: { serverId } });
    const result = await withServerConn(serverId, async (conn) => {
      for (const site of sites) {
        await nginxWriteSite(conn, site.name, site.content, site.enabled);
      }
      const test = await nginxTestConfig(conn);
      if (!test.ok) return { ok: false, stage: "test", count: sites.length, output: test.output };
      const reload = await nginxReload(conn);
      return { ok: reload.ok, stage: "reload", count: sites.length, output: reload.output };
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "同步失败: " + (e as Error).message }, { status: 500 });
  }
}
