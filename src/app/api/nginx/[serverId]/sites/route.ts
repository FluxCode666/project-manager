import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withServerConn } from "@/app/api/nginx/_lib";
import {
  isValidSiteName,
  nginxListRemoteSites,
  nginxWriteSite,
  nginxTestConfig,
  nginxReload,
} from "@/lib/nginx";

export const runtime = "nodejs";

type Params = { params: Promise<{ serverId: string }> };

// 站点列表（GET ?remote=1 时附带服务器 conf.d 中的文件清单）
export async function GET(request: NextRequest, { params }: Params) {
  const { serverId } = await params;
  try {
    const sites = await db.nginxSite.findMany({
      where: { serverId },
      orderBy: { name: "asc" },
    });

    const wantRemote = request.nextUrl.searchParams.get("remote") === "1";
    let remote: { filename: string; enabled: boolean }[] | null = null;
    if (wantRemote) {
      remote = await withServerConn(serverId, (conn) => nginxListRemoteSites(conn));
    }
    return NextResponse.json({ sites, remote });
  } catch (e) {
    return NextResponse.json({ error: "加载站点失败: " + (e as Error).message }, { status: 500 });
  }
}

// 创建站点（?push=1 时同时写入服务器并校验+重载）
export async function POST(request: NextRequest, { params }: Params) {
  const { serverId } = await params;
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const content = String(body.content ?? "");
  const domains = body.domains ? String(body.domains) : null;
  const enabled = body.enabled !== false;
  const notes = body.notes ? String(body.notes) : null;
  const push = request.nextUrl.searchParams.get("push") === "1";

  if (!name) return NextResponse.json({ error: "站点名称不能为空" }, { status: 400 });
  if (!isValidSiteName(name)) {
    return NextResponse.json({ error: "站点名称只能包含字母、数字、点、下划线、连字符" }, { status: 400 });
  }

  try {
    const dup = await db.nginxSite.findFirst({ where: { serverId, name } });
    if (dup) return NextResponse.json({ error: `站点「${name}」已存在` }, { status: 400 });

    const site = await db.nginxSite.create({
      data: { serverId, name, content, domains, enabled, notes },
    });

    let pushResult = null;
    if (push) {
      pushResult = await withServerConn(serverId, async (conn) => {
        await nginxWriteSite(conn, name, content, enabled);
        const test = await nginxTestConfig(conn);
        if (!test.ok) return { ok: false, stage: "test", output: test.output };
        const reload = await nginxReload(conn);
        return { ok: reload.ok, stage: "reload", output: reload.output };
      });
    }

    return NextResponse.json({ site, push: pushResult }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "创建站点失败: " + (e as Error).message }, { status: 500 });
  }
}
