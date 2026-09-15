import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sshConnect, sftpListFiles, sftpReadFile } from "@/lib/ssh";

export const runtime = "nodejs";

function validFilename(filename: string): boolean {
  return !!filename && filename !== "." && filename !== ".." && !filename.includes("/") && !filename.includes("\\") && !/[\u0000-\u001f\u007f]/.test(filename);
}

async function getTarget(id: string) {
  return db.deployTarget.findUnique({ include: { server: true, environment: true }, where: { id } });
}

// 列出服务器部署目录中的普通文件
export async function GET(request: NextRequest) {
  const deployTargetId = request.nextUrl.searchParams.get("deployTargetId");
  if (!deployTargetId) return NextResponse.json({ error: "deployTargetId 为必填项" }, { status: 400 });
  const target = await getTarget(deployTargetId);
  if (!target) return NextResponse.json({ error: "部署目标不存在" }, { status: 404 });
  try {
    const conn = await sshConnect(target.server);
    const files = await sftpListFiles(conn, target.environment.deployPath);
    conn.end();
    return NextResponse.json({ files });
  } catch (e) {
    return NextResponse.json({ error: `读取服务器文件失败: ${(e as Error).message}` }, { status: 500 });
  }
}

// 将服务器文件导入系统。mode=target 保存为该服务器专属文件，mode=shared 保存为环境共享文件。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const deployTargetId = String(body.deployTargetId ?? "");
    const mode = body.mode === "shared" ? "shared" : "target";
    const target = await getTarget(deployTargetId);
    if (!target) return NextResponse.json({ error: "部署目标不存在" }, { status: 404 });
    const requested: string[] = Array.isArray(body.filenames)
      ? (body.filenames as unknown[]).map((value) => String(value)).filter((value): value is string => validFilename(value))
      : [];
    if (!requested.length) return NextResponse.json({ error: "请选择要导入的文件" }, { status: 400 });

    const conn = await sshConnect(target.server);
    const imported: string[] = [];
    const skipped: string[] = [];
    try {
      for (const filename of [...new Set(requested)]) {
        const content = await sftpReadFile(conn, `${target.environment.deployPath.replace(/\/+$/, "")}/${filename}`);
        if (content === null) { skipped.push(filename); continue; }
        if (mode === "shared") {
          await db.envFile.upsert({
            where: { environmentId_filename: { environmentId: target.environmentId, filename } },
            create: { environmentId: target.environmentId, filename, content },
            update: { content },
          });
          // 当前服务器若已有同名专属文件，删除它以免继续覆盖刚升级的共享文件。
          await db.targetFile.deleteMany({ where: { deployTargetId, filename } });
        } else {
          await db.targetFile.upsert({
            where: { deployTargetId_filename: { deployTargetId, filename } },
            create: { deployTargetId, filename, content },
            update: { content },
          });
        }
        imported.push(filename);
      }
    } finally {
      conn.end();
    }
    return NextResponse.json({ imported, skipped, mode });
  } catch (e) {
    return NextResponse.json({ error: `导入失败: ${(e as Error).message}` }, { status: 500 });
  }
}
