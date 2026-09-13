import { NextResponse } from "next/server";
import { runBackup } from "@/lib/backup";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/backup/run —— 立即执行一次备份
export async function POST() {
  const result = await runBackup("manual");
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
