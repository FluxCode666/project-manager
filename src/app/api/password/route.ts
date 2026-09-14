import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkPassword, invalidatePasswordCache } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/password —— 修改控制台登录密码
// { currentPassword, newPassword }
export async function POST(request: NextRequest) {
  try {
    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "请填写当前密码和新密码" }, { status: 400 });
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return NextResponse.json({ error: "新密码至少 8 位" }, { status: 400 });
    }

    const valid = await checkPassword(currentPassword);
    if (!valid) {
      return NextResponse.json({ error: "当前密码错误" }, { status: 401 });
    }

    // 存入数据库（优先于环境变量）
    await db.appSetting.upsert({
      where: { key: "app_password" },
      update: { value: newPassword },
      create: { key: "app_password", value: newPassword },
    });
    invalidatePasswordCache();

    return NextResponse.json({ ok: true, message: "密码已修改，下次登录使用新密码" });
  } catch (e) {
    return NextResponse.json({ error: "修改失败: " + (e as Error).message }, { status: 500 });
  }
}
