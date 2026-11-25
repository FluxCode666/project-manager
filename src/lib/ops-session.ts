import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function requireOpsSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ error: "该接口需要登录会话" }, { status: 401 });
  }
  if (request.headers.get("authorization")?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "该接口只能通过浏览器登录会话访问" }, { status: 403 });
  }
  return null;
}
