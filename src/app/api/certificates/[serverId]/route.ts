import { NextResponse, type NextRequest } from "next/server";
import { withServerConn } from "@/app/api/nginx/_lib";
import { requireOpsSession } from "@/lib/ops-session";
import {
  CERT_WEBROOT,
  buildGuideSteps,
  certbotIssue,
  certbotListCertificates,
  certbotProbe,
  certbotRenew,
  isValidCertName,
  isValidDomain,
  isValidEmail,
  isValidWebroot,
} from "@/lib/certificates";

export const runtime = "nodejs";

type Params = { params: Promise<{ serverId: string }> };

function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

// GET /api/certificates/[serverId]
// 列出宿主机 Certbot 管理的证书（名称/域名/有效期），只读、不返回任何密钥内容。
// ?check=1 仅探测 certbot 可用性（区分未安装/未授权/可用及执行身份）。
// ?guide=1&domains=a.com,b.com&certName=a.com&email=x@y.z 返回分步指引与可复制配置模板，
// 模板由服务端统一生成，前端不复制模板逻辑。
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireOpsSession(request);
  if (denied) return denied;
  const { serverId } = await params;
  const url = new URL(request.url);

  if (url.searchParams.get("guide") === "1") {
    const domains = (url.searchParams.get("domains") ?? "")
      .split(/[\s,]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    const certName = (url.searchParams.get("certName") ?? "").trim() || domains[0] || "example.com";
    const email = (url.searchParams.get("email") ?? "").trim();
    if (domains.length === 0 || domains.length > 10) return jsonError("domains 参数无效（1-10 个域名）");
    const badDomain = domains.find((d) => !isValidDomain(d));
    if (badDomain) return jsonError(`域名无效：${badDomain}`);
    if (!isValidCertName(certName)) return jsonError("证书名称无效");
    if (email && !isValidEmail(email)) return jsonError("邮箱格式无效");
    // 纯模板生成，不触发 SSH
    const steps = buildGuideSteps({ domains, email: email || undefined, certName, webroot: CERT_WEBROOT });
    return NextResponse.json({ steps });
  }

  try {
    if (url.searchParams.get("check") === "1") {
      const probe = await withServerConn(serverId, (conn) => certbotProbe(conn));
      return NextResponse.json(probe);
    }
    const result = await withServerConn(serverId, (conn) => certbotListCertificates(conn));
    return NextResponse.json(result);
  } catch (e) {
    return jsonError("获取证书列表失败: " + (e as Error).message, 500);
  }
}

// 解析 JSON 请求体；null / 数组 / 原始类型一律视为无效
async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

// POST /api/certificates/[serverId]
// 申请真实证书（Let's Encrypt 生产端点，webroot HTTP-01）。
// 必须显式 confirm:true，且由用户在前端确认后提交；不会自动发起。
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireOpsSession(request);
  if (denied) return denied;
  const { serverId } = await params;
  const body = await readJsonObject(request);
  if (!body) return jsonError("请求体必须是 JSON 对象");

  if (!Array.isArray(body.domains) || body.domains.some((domain) => typeof domain !== "string")) {
    return jsonError("domains 必须是域名字符串数组");
  }
  const domains = [...new Set(body.domains.map((domain: string) => domain.trim().toLowerCase()).filter(Boolean))];
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const certName = typeof body.certName === "string" ? body.certName.trim() : "";
  const webroot = typeof body.webroot === "string" && body.webroot.trim() ? body.webroot.trim() : CERT_WEBROOT;

  if (domains.length === 0) return jsonError("至少填写一个域名");
  if (domains.length > 10) return jsonError("一次申请最多 10 个域名");
  const badDomain = domains.find((d) => !isValidDomain(d));
  if (badDomain) return jsonError(`域名无效：${badDomain}（仅支持标准域名，不支持通配符）`);
  if (!isValidEmail(email)) return jsonError("邮箱格式无效");
  if (!isValidCertName(certName)) {
    return jsonError("证书名称无效：仅允许字母、数字、点、下划线、连字符，且不能以点开头");
  }
  if (!isValidWebroot(webroot)) return jsonError("webroot 路径无效：须为无空格的绝对路径");
  if (body.confirm !== true) return jsonError("缺少确认：请勾选确认后重新提交（不会自动申请）");

  try {
    const result = await withServerConn(serverId, (conn) =>
      certbotIssue(conn, { domains, email, certName, webroot }),
    );
    if (result.unauthorized) {
      return jsonError(
        "当前 SSH 用户无权执行 certbot。请使用已有执行权限的 SSH 账号，或请管理员在宿主机操作（见指引第 3 步）",
        403,
        { output: result.output },
      );
    }
    if (result.lockBusy) {
      return jsonError(
        "Certbot 正被另一个进程占用（可能是重复提交或定时续期），请稍后重试",
        409,
        { output: result.output },
      );
    }
    if (!result.ok) {
      return jsonError(
        "申请失败。请检查：DNS 是否已解析到本机、公网 80 是否可达、ACME challenge 配置是否生效",
        502,
        { output: result.output },
      );
    }
    return NextResponse.json({ ok: true, output: result.output });
  } catch (e) {
    return jsonError("申请请求执行失败: " + (e as Error).message, 500);
  }
}

// PUT /api/certificates/[serverId]
// 按证书名称手动续期（certbot renew 只在临近到期时实际续期，不强制）。
export async function PUT(request: NextRequest, { params }: Params) {
  const denied = await requireOpsSession(request);
  if (denied) return denied;
  const { serverId } = await params;
  const body = await readJsonObject(request);
  if (!body) return jsonError("请求体必须是 JSON 对象");
  const certName = typeof body.certName === "string" ? body.certName.trim() : "";
  if (!isValidCertName(certName)) return jsonError("证书名称无效");

  try {
    const result = await withServerConn(serverId, (conn) => certbotRenew(conn, certName));
    if (result.unauthorized) {
      return jsonError(
        "当前 SSH 用户无权执行 certbot。请使用已有执行权限的 SSH 账号，或请管理员在宿主机操作",
        403,
        { output: result.output },
      );
    }
    if (result.lockBusy) {
      return jsonError(
        "Certbot 正被另一个进程占用（可能是重复提交或定时续期），请稍后重试",
        409,
        { output: result.output },
      );
    }
    if (!result.ok) {
      return jsonError("续期失败，请查看输出定位原因", 502, { output: result.output });
    }
    return NextResponse.json({ ok: true, output: result.output });
  } catch (e) {
    return jsonError("续期请求执行失败: " + (e as Error).message, 500);
  }
}
