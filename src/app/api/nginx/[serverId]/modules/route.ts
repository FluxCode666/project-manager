import { NextRequest, NextResponse } from "next/server";
import { withServerConn } from "@/app/api/nginx/_lib";
import {
  nginxDetectModules,
  nginxDetectPackageManager,
  nginxEnableModule,
  nginxDisableModule,
  nginxInstallModule,
} from "@/lib/nginx";

export const runtime = "nodejs";

type Params = { params: Promise<{ serverId: string }> };

// 探测模块：静态编译模块、动态 .so 模块、已加载状态、包管理器
export async function GET(_request: Request, { params }: Params) {
  const { serverId } = await params;
  try {
    const report = await withServerConn(serverId, async (conn) => {
      const modules = await nginxDetectModules(conn);
      const packageManager = await nginxDetectPackageManager(conn);
      return { ...modules, packageManager };
    });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: "探测模块失败: " + (e as Error).message }, { status: 500 });
  }
}

// 操作：enable（加载动态模块）/ disable（卸载）/ install（安装包）
export async function POST(request: NextRequest, { params }: Params) {
  const { serverId } = await params;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");

  try {
    const result = await withServerConn(serverId, async (conn) => {
      if (action === "enable") {
        const soPath = String(body.soPath ?? "");
        if (!soPath) return { ok: false, output: "缺少模块路径" };
        return nginxEnableModule(conn, soPath);
      }
      if (action === "disable") {
        const soPath = String(body.soPath ?? "");
        if (!soPath) return { ok: false, output: "缺少模块路径" };
        return nginxDisableModule(conn, soPath);
      }
      if (action === "install") {
        const pkg = String(body.pkg ?? "");
        if (!pkg) return { ok: false, output: "缺少包名" };
        const pm = await nginxDetectPackageManager(conn);
        if (!pm) return { ok: false, output: "未检测到 apt/dnf/yum，请手动安装" };
        return nginxInstallModule(conn, pkg, pm);
      }
      return { ok: false, output: `未知操作: ${action}` };
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "模块操作失败: " + (e as Error).message }, { status: 500 });
  }
}
