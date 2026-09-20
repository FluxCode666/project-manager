import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withServerConn } from "@/app/api/nginx/_lib";
import { sftpReadFile } from "@/lib/ssh";
import {
  isValidSiteName,
  NGINX_CONF_D,
  nginxWriteSite,
  nginxDeleteSite,
  nginxTestConfig,
  nginxReload,
} from "@/lib/nginx";

export const runtime = "nodejs";

type Params = { params: Promise<{ serverId: string; name: string }> };

// 读取单个站点（?remote=1 时读取服务器 conf.d 中的实际内容，用于导入）
export async function GET(request: NextRequest, { params }: Params) {
  const { serverId, name } = await params;
  const wantRemote = request.nextUrl.searchParams.get("remote") === "1";

  if (wantRemote) {
    if (!isValidSiteName(name)) {
      return NextResponse.json({ error: "站点名称不合法" }, { status: 400 });
    }
    try {
      const content = await withServerConn(serverId, (conn) =>
        sftpReadFile(conn, `${NGINX_CONF_D}/${name}.conf`),
      );
      if (content == null) {
        return NextResponse.json({ error: `服务器上不存在 ${name}.conf` }, { status: 404 });
      }
      return NextResponse.json({ name, content });
    } catch (e) {
      return NextResponse.json({ error: "读取远程配置失败: " + (e as Error).message }, { status: 500 });
    }
  }

  try {
    const site = await db.nginxSite.findFirst({ where: { serverId, name } });
    if (!site) return NextResponse.json({ error: "站点不存在" }, { status: 404 });
    return NextResponse.json(site);
  } catch (e) {
    return NextResponse.json({ error: "读取站点失败: " + (e as Error).message }, { status: 500 });
  }
}

// 更新站点（?push=1 时同步写入服务器）
export async function PUT(request: NextRequest, { params }: Params) {
  const { serverId, name } = await params;
  const body = await request.json().catch(() => ({}));
  const push = request.nextUrl.searchParams.get("push") === "1";

  try {
    const existing = await db.nginxSite.findFirst({ where: { serverId, name } });
    if (!existing) return NextResponse.json({ error: "站点不存在" }, { status: 404 });

    const site = await db.nginxSite.update({
      where: { id: existing.id },
      data: {
        content: body.content !== undefined ? String(body.content) : existing.content,
        domains: body.domains !== undefined ? (body.domains ? String(body.domains) : null) : existing.domains,
        enabled: body.enabled !== undefined ? Boolean(body.enabled) : existing.enabled,
        notes: body.notes !== undefined ? (body.notes ? String(body.notes) : null) : existing.notes,
      },
    });

    let pushResult = null;
    if (push) {
      pushResult = await withServerConn(serverId, async (conn) => {
        await nginxWriteSite(conn, name, site.content, site.enabled);
        const test = await nginxTestConfig(conn);
        if (!test.ok) return { ok: false, stage: "test", output: test.output };
        const reload = await nginxReload(conn);
        return { ok: reload.ok, stage: "reload", output: reload.output };
      });
    }

    return NextResponse.json({ site, push: pushResult });
  } catch (e) {
    return NextResponse.json({ error: "更新站点失败: " + (e as Error).message }, { status: 500 });
  }
}

// 删除站点（?remote=1 时同时删除服务器上的配置文件）
export async function DELETE(request: NextRequest, { params }: Params) {
  const { serverId, name } = await params;
  const removeRemote = request.nextUrl.searchParams.get("remote") === "1";

  try {
    const existing = await db.nginxSite.findFirst({ where: { serverId, name } });
    if (!existing) return NextResponse.json({ error: "站点不存在" }, { status: 404 });

    await db.nginxSite.delete({ where: { id: existing.id } });

    let pushResult = null;
    if (removeRemote) {
      pushResult = await withServerConn(serverId, async (conn) => {
        await nginxDeleteSite(conn, name);
        const test = await nginxTestConfig(conn);
        if (!test.ok) return { ok: false, stage: "test", output: test.output };
        const reload = await nginxReload(conn);
        return { ok: reload.ok, stage: "reload", output: reload.output };
      });
    }

    return NextResponse.json({ ok: true, push: pushResult });
  } catch (e) {
    return NextResponse.json({ error: "删除站点失败: " + (e as Error).message }, { status: 500 });
  }
}
