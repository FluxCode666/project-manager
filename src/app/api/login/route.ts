import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, checkPassword, createSessionToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    if (!password || !checkPassword(password)) {
      return NextResponse.json({ error: "密码错误" }, { status: 401 });
    }
    const token = await createSessionToken();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
}
