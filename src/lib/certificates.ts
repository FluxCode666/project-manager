import type { Client } from "ssh2";
import { sshExec } from "@/lib/ssh";

// ---- 常量（固定值，避免受环境变量影响） ----

// webroot 与部署示例 deploy/nginx 保持一致
export const CERT_WEBROOT = "/var/www/html";
// Let's Encrypt 生产 ACME 端点（显式指定，不使用 staging / 其他 CA）
export const LE_PROD_SERVER = "https://acme-v02.api.letsencrypt.org/directory";
// Certbot 证书存放根目录（仅读取元信息，不导出密钥内容；nginx 直接引用该路径）
export const CERTBOT_LIVE_DIR = "/etc/letsencrypt/live";

export const SSH_CMD_TIMEOUT_MS = 60000;
const CERTBOT_LOCK_WAIT_SECONDS = 300;

// 固定 PATH，避免用户 shell / 环境变量注入非预期 certbot
const SAFE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

// 命令前缀：探测结果决定使用 root 直跑还是 sudo。
// env -i 只保留白名单变量，不要求 sudoers 放开环境变量（env_keep），也不要求对任意 certbot 参数授权。
interface CmdPrefix {
  kind: "root" | "sudo";
  run: (inner: string) => string;
}
const ROOT_PREFIX: CmdPrefix = {
  kind: "root",
  run: (inner) => `env -i PATH=${SAFE_PATH} LC_ALL=C ${inner}`,
};
const SUDO_PREFIX: CmdPrefix = {
  kind: "sudo",
  run: (inner) =>
    // sudo 默认会重置环境（secure_path/env_reset），传入的 PATH/LC_ALL 经 sudo 安全策略处理，
    // 不需要 sudoers 额外放开 env；sudo -n 保证无授权时快速失败而不是挂起等密码。
    `sudo -n env -i PATH=${SAFE_PATH} LC_ALL=C ${inner}`,
};

// ---- 校验 ----

const CERT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DOMAIN_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function isValidCertName(name: string): boolean {
  if (!CERT_NAME_RE.test(name)) return false;
  if (name.includes("..")) return false; // 防路径穿越
  return true;
}

export function isValidDomain(domain: string): boolean {
  if (domain.length === 0 || domain.length > 253) return false;
  if (domain.includes("*")) return false; // 不支持通配符（需要 DNS-01，超出范围）
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  return labels.every((l) => DOMAIN_LABEL_RE.test(l));
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

export function isValidWebroot(path: string): boolean {
  // 优先固定默认 webroot；自定义时严格限制为无空格/无特殊字符的绝对路径
  if (path === CERT_WEBROOT) return true;
  return /^\/[A-Za-z0-9._\-/]{1,199}$/.test(path) && !path.includes("..");
}

function sh(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// ---- 解析 ----

export interface CertificateInfo {
  name: string; // 证书名称（/etc/letsencrypt/live/<name>）
  domains: string[];
  expiryDate: string | null; // ISO 日期（UTC 00:00）
  daysRemaining: number | null; // 按整天计算；不足 1 天为 0，已过期为负数
}

// 解析 `certbot certificates` 文本输出。
// 证书块格式：
//   Certificate Name: example.com
//     Serial Number: ...
//     Key Type: ...
//     Domains: example.com www.example.com
//     Expiry Date: 2027-02-24 08:00:00+00:00 (VALID: 89 days)
//     Certificate Path: /etc/letsencrypt/live/example.com/fullchain.pem
//     Private Key Path: /etc/letsencrypt/live/example.com/privkey.pem
export function parseCertbotCertificates(output: string): CertificateInfo[] {
  const certs: CertificateInfo[] = [];
  const blocks = output.split(/(?=^[ \t]*Certificate Name:)/m);

  for (const block of blocks) {
    const name = block.match(/^\s*Certificate Name:\s*(\S+)\s*$/m)?.[1];
    if (!name) continue;
    const domainsRaw = block.match(/^\s*Domains:\s*(.+)$/m)?.[1] ?? "";
    const domains = domainsRaw.trim().split(/\s+/).filter(Boolean);
    // VALID: N days；过期证书 certbot 输出 (INVALID) 或 (EXPIRED)
    const validMatch = block.match(
      /^\s*Expiry Date:\s*(\d{4}-\d{2}-\d{2})[^()]*\(VALID:\s*(\d+)\s+days?\)/m,
    );
    const dateOnly = block.match(/^\s*Expiry Date:\s*(\d{4}-\d{2}-\d{2})/m)?.[1];
    const expired = /\((?:INVALID|EXPIRED)(?::[^)]*)?\)/i.test(block);
    certs.push({
      name,
      domains,
      expiryDate: validMatch?.[1] ?? dateOnly ?? null,
      daysRemaining: validMatch ? parseInt(validMatch[2], 10) : expired ? -1 : null,
    });
  }
  return certs;
}

// 判断 certbot 输出是否表示"没有任何证书"
export function isNoCertificatesOutput(output: string): boolean {
  return /No (?:certs|certificates) found/i.test(output);
}

// ---- 预检（区分未安装 / 未授权 / 可用） ----

export type CertbotAccess =
  | { state: "ok"; version: string; via: "root" | "sudo" }
  | { state: "not_installed" }
  | { state: "unauthorized"; via: "root" | "sudo"; detail: string };

function isPermissionIssue(output: string): boolean {
  return /sudo: .*password|not in the sudoers|a password is required|permission denied|must be (run as )?root/i.test(
    output,
  );
}

async function tryVersion(conn: Client, prefix: CmdPrefix): Promise<{ ok: boolean; out: string }> {
  const res = await sshExec(conn, prefix.run("certbot --version") + " 2>&1", SSH_CMD_TIMEOUT_MS);
  return { ok: res.code === 0, out: (res.stdout + res.stderr).trim() };
}

// 探测 certbot 可用性：先按当前身份（可能已是 root），再尝试免密 sudo。
// 未安装与未授权分别返回，便于页面给出对应指引。
export async function certbotProbe(conn: Client): Promise<CertbotAccess> {
  const direct = await tryVersion(conn, ROOT_PREFIX);
  const identity = await sshExec(conn, "id -u", SSH_CMD_TIMEOUT_MS);
  if (direct.ok && identity.code === 0 && identity.stdout.trim() === "0") {
    const version = direct.out.match(/certbot\s+(\S+)/)?.[1] ?? direct.out;
    return { state: "ok", version, via: "root" };
  }
  if (!direct.ok && /command not found|not found|no such file/i.test(direct.out)) {
    return { state: "not_installed" };
  }

  const elevated = await tryVersion(conn, SUDO_PREFIX);
  if (elevated.ok) {
    const version = elevated.out.match(/certbot\s+(\S+)/)?.[1] ?? elevated.out;
    return { state: "ok", version, via: "sudo" };
  }
  if (direct.ok || isPermissionIssue(elevated.out)) {
    return { state: "unauthorized", via: "sudo", detail: elevated.out.slice(0, 300) };
  }
  const sudoMissing = /command not found|not found|no such file/i.test(elevated.out);
  if (sudoMissing) return { state: "not_installed" };
  // 其它失败（如 PATH 中 snap certbot 异常）：按未安装提示并给出可操作方向
  return { state: "not_installed" };
}

// 兼容旧调用名
export async function certbotCheckInstalled(conn: Client): Promise<{ installed: boolean; version: string | null }> {
  const probe = await certbotProbe(conn);
  return probe.state === "ok"
    ? { installed: true, version: probe.version }
    : { installed: false, version: null };
}

// ---- 只读列表 ----

export type CertListResult =
  | { state: "ok"; certs: CertificateInfo[]; version: string | null; via: "root" | "sudo" }
  | { state: "not_installed" }
  | { state: "unauthorized"; detail: string }
  | { state: "no_certs"; version: string | null; via: "root" | "sudo" };

export async function certbotListCertificates(conn: Client): Promise<CertListResult> {
  const probe = await certbotProbe(conn);
  if (probe.state === "not_installed") return { state: "not_installed" };
  if (probe.state === "unauthorized") return { state: "unauthorized", detail: probe.detail };

  const prefix = probe.via === "root" ? ROOT_PREFIX : SUDO_PREFIX;
  const res = await sshExec(conn, prefix.run("certbot certificates") + " 2>&1", SSH_CMD_TIMEOUT_MS);
  const out = (res.stdout + res.stderr).trim();
  if (res.code !== 0 && isPermissionIssue(out)) {
    return { state: "unauthorized", detail: out.slice(0, 300) };
  }
  if (isNoCertificatesOutput(out)) {
    return { state: "no_certs", version: probe.version, via: probe.via };
  }
  const certs = parseCertbotCertificates(out);
  if (certs.length === 0 && res.code !== 0) {
    return { state: "unauthorized", detail: out.slice(0, 300) };
  }
  return { state: "ok", certs, version: probe.version, via: probe.via };
}

// ---- 变更操作（申请 / 续期），固定子命令与选项 ----

export interface CertbotRunResult {
  ok: boolean;
  output: string; // stdout+stderr 合并（尾部），不含任何密钥内容
  lockBusy: boolean; // 命中 certbot 锁（并发/重复提交）
  unauthorized: boolean; // 无 root/免密 sudo 权限
}

async function runCertbot(conn: Client, args: string, timeoutMs: number): Promise<CertbotRunResult> {
  const probe = await certbotProbe(conn);
  if (probe.state !== "ok") {
    return {
      ok: false,
      output:
        probe.state === "not_installed"
          ? "宿主机未安装 certbot"
          : `当前 SSH 用户无权执行 certbot：${probe.detail}`,
      lockBusy: false,
      unauthorized: true,
    };
  }
  const prefix = probe.via === "root" ? ROOT_PREFIX : SUDO_PREFIX;
  const cmd =
    prefix.run(`env CERTBOT_LOCK_WAIT=${CERTBOT_LOCK_WAIT_SECONDS} certbot ${args} --non-interactive`) + " 2>&1";
  const res = await sshExec(conn, cmd, timeoutMs);
  const merged = (res.stdout + res.stderr).trim();
  // 输出只保留尾部 4000 字符，足够定位错误且不会过大
  const out = merged.length > 4000 ? merged.slice(-4000) : merged;
  const lockBusy = res.code !== 0 && /lock/i.test(out) && /(other process|Another instance)/i.test(out);
  const unauthorized = res.code !== 0 && isPermissionIssue(out);
  return { ok: res.code === 0, output: out, lockBusy, unauthorized };
}

export interface IssueOptions {
  domains: string[]; // 已校验
  email: string; // 已校验
  certName: string; // 已校验
  webroot: string; // 已校验（默认 /var/www/html）
}

// 通过 webroot HTTP-01 向 Let's Encrypt 生产端点申请证书（不强制续期、不自动改 nginx）
export function buildIssueArgs(o: IssueOptions): string {
  const domainArgs = o.domains.map((d) => `-d ${sh(d)}`).join(" ");
  return [
    "certonly",
    "--webroot",
    `-w ${sh(o.webroot)}`,
    domainArgs,
    `--cert-name ${sh(o.certName)}`,
    `--email ${sh(o.email)}`,
    "--agree-tos",
    "--no-eff-email",
    "--keep-until-expiring",
    `--server ${LE_PROD_SERVER}`,
  ].join(" ");
}

export async function certbotIssue(conn: Client, o: IssueOptions): Promise<CertbotRunResult> {
  // 申请可能触发 ACME 多次 HTTP 挑战，放宽到 3 分钟
  return runCertbot(conn, buildIssueArgs(o), 180000);
}

// 按证书名称续期（不强制：certbot 仅在临近到期时实际续期）
export function buildRenewArgs(certName: string): string {
  return `renew --cert-name ${sh(certName)}`;
}

export async function certbotRenew(conn: Client, certName: string): Promise<CertbotRunResult> {
  return runCertbot(conn, buildRenewArgs(certName), 120000);
}

// ---- 可复制的指引与配置模板（不在宿主机执行任何写入） ----

export interface CertGuideInput {
  domains: string[];
  email?: string;
  certName: string;
  webroot: string; // 默认 /var/www/html
  upstreamPort?: number; // 反向代理端口，默认 3000（与 .env 的 SERVER_PORT 对应）
}

export interface GuideStep {
  id: string;
  title: string;
  description: string;
  commands?: string[]; // 可复制命令（宿主机执行）
  config?: string; // 可复制配置片段
  configName?: string;
}

// 仅 ACME challenge 片段：已有 80 端口站点只需加入这一段，不整站覆盖
export function buildAcmeLocationSnippet(input: CertGuideInput): string {
  return `# ACME HTTP-01 验证目录：加入已有 80 端口 server 块内即可（保留原有其它配置）
location ^~ /.well-known/acme-challenge/ {
    root ${input.webroot};
    default_type "text/plain";
    try_files $uri =404;
}
`;
}

// Nginx 最小 80 端口配置：仅当该域名还没有任何站点配置时使用（首次申请，不依赖缺失证书）
export function buildAcmeHttpConfig(input: CertGuideInput): string {
  const serverName = input.domains.join(" ");
  return `# ${input.certName}：首次申请证书用（仅当该域名还没有任何站点配置时使用）
# 已有站点时不要使用本文件，只把 challenge 片段加入现有 server 块。
server {
    listen 80;
    listen [::]:80;
    server_name ${serverName};

    location ^~ /.well-known/acme-challenge/ {
        root ${input.webroot};
        default_type "text/plain";
        try_files $uri =404;
    }

    location / {
        return 200 'ACME bootstrap for ${input.certName}';
        add_header Content-Type text/plain;
    }
}
`;
}

// HTTPS server 块（证书就位后加入/替换 80 块），证书直接引用 certbot live 路径，
// 不把私钥复制到第二处，nginx 以 root 启动主进程可正常读取。
export function buildTlsProxyConfig(input: CertGuideInput): string {
  const serverName = input.domains.join(" ");
  const primary = input.domains[0] ?? input.certName;
  const port = input.upstreamPort ?? 3000;
  return `# ${input.certName}：HTTPS 反向代理（证书申请完成后使用）
server {
    listen 80;
    listen [::]:80;
    server_name ${serverName};

    # ACME 续期验证不跳转 HTTPS
    location ^~ /.well-known/acme-challenge/ {
        root ${input.webroot};
        default_type "text/plain";
        try_files $uri =404;
    }

    location / {
        return 308 https://${primary}$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${serverName};

    # 直接使用 certbot 管理的证书，无需复制私钥到其它目录
    ssl_certificate ${CERTBOT_LIVE_DIR}/${input.certName}/fullchain.pem;
    ssl_certificate_key ${CERTBOT_LIVE_DIR}/${input.certName}/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    client_max_body_size 10m;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Connection "";

    proxy_connect_timeout 10s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
    proxy_buffering off;
    proxy_cache off;

    location / {
        proxy_pass http://127.0.0.1:${port};
    }
}
`;
}

// Certbot deploy hook：只在本次续期 lineage 匹配本证书时校验并重载 nginx，
// 不复制任何证书/私钥（nginx 直接引用 live 路径）。
export function buildDeployHookScript(input: CertGuideInput): string {
  const lineage = `${CERTBOT_LIVE_DIR}/${input.certName}`;
  return `#!/bin/sh
# Certbot deploy hook：仅当续期的是 ${input.certName} 时重载 nginx
# nginx 直接引用 ${lineage}，无需同步文件
[ "$RENEWED_LINEAGE" = ${sh(lineage)} ] || exit 0
nginx -t && systemctl reload nginx
`;
}

// 生成完整的分步指引
export function buildGuideSteps(input: CertGuideInput): GuideStep[] {
  const webrootChallenge = `${input.webroot}/.well-known/acme-challenge`;
  const issueArgs = buildIssueArgs({
    domains: input.domains,
    email: input.email ?? "admin@example.com",
    certName: input.certName,
    webroot: input.webroot,
  });
  return [
    {
      id: "dns",
      title: "1. DNS 解析",
      description:
        `为 ${input.domains.join("、")} 配置 A 记录（IPv6 用 AAAA 记录）指向本服务器公网 IP，` +
        "并等待解析生效。可用 dig 验证：",
      commands: input.domains.map((d) => `dig +short A ${d}\ndig +short AAAA ${d}`),
    },
    {
      id: "firewall",
      title: "2. 开放公网 80 端口",
      description:
        "HTTP-01 验证要求 Let's Encrypt 能通过公网 80 端口访问本机。" +
        "在云安全组和防火墙（ufw/firewalld/iptables）中放行 80（后续 HTTPS 还需要 443）。",
      commands: ["sudo ufw allow 80/tcp\nsudo ufw allow 443/tcp"],
    },
    {
      id: "access",
      title: "3. 安装 Certbot 并准备执行权限",
      description:
        "在宿主机安装 certbot（选择其一）。应用需要已有权限的 SSH 账号才能执行 Certbot；" +
        "如果当前账号没有权限，请让管理员在宿主机手动运行第 5 步命令，不要为了启用此功能放开 sudo 权限。",
      commands: [
        "sudo apt-get update && sudo apt-get install -y certbot",
        "sudo dnf install -y certbot",
        "sudo snap install --classic certbot && sudo ln -sf /snap/bin/certbot /usr/bin/certbot",
      ],
    },
    {
      id: "nginx-acme",
      title: "4. 配置 Nginx ACME 验证目录",
      description:
        "首次申请时证书尚不存在，配置不能引用缺失的证书文件。" +
        "已有站点：只把下方 challenge 片段加入现有 80 端口 server 块（不要整站覆盖）。" +
        "新站点见下一步。加载配置后在服务器写入测试文件，再从公网确认每个域名都能返回 acme-ok。",
      commands: [
        `sudo mkdir -p ${webrootChallenge}`,
        "sudo nginx -t && sudo systemctl reload nginx",
        `printf '%s\\n' acme-ok | sudo tee ${webrootChallenge}/pm-acme-check.txt`,
        ...input.domains.map((domain) => `curl -fsS http://${domain}/.well-known/acme-challenge/pm-acme-check.txt`),
        `sudo rm -f ${webrootChallenge}/pm-acme-check.txt`,
      ],
      config: buildAcmeLocationSnippet(input),
      configName: "acme-challenge 片段.conf",
    },
    {
      id: "nginx-new-site",
      title: "新站点的最小 HTTP 配置（可选）",
      description: "仅当域名尚未配置站点时使用。保存后按第 4 步校验、重载并测试验证路径。",
      config: buildAcmeHttpConfig(input),
      configName: `${input.certName}.conf`,
    },
    {
      id: "issue",
      title: "5. 申请证书",
      description:
        "回到本页面在「申请证书」中确认提交（应用不会自动申请）。命令等价于在宿主机执行：" +
        "（已固定 Let's Encrypt 生产端点、webroot 路径与非交互参数）",
      commands: [`sudo certbot ${issueArgs} --non-interactive`],
    },
    {
      id: "nginx-tls",
      title: "6. 配置 HTTPS 反代",
      description:
        `申请成功后，nginx 直接引用 ${CERTBOT_LIVE_DIR}/${input.certName}/ 下的证书` +
        "（私钥只保留在 certbot 目录，不复制到第二处）。已有站点只合并证书配置并保留原有转发规则；" +
        "新站点可用下方示例替换临时配置，按需修改上游地址。保留 HTTP 验证路径用于续期。",
      commands: ["sudo nginx -t && sudo systemctl reload nginx"],
      config: buildTlsProxyConfig(input),
      configName: `${input.certName}.conf`,
    },
    {
      id: "renewal",
      title: "7. 定时续期与 deploy hook",
      description:
        "确认系统定时任务包含 certbot renew（包管理器安装通常自带 certbot.timer / /etc/cron.d/certbot），" +
        "并安装 deploy hook：只在续期的是本证书时执行 nginx -t 并重载，不会误碰其它证书的站点。",
      commands: [
        "systemctl list-timers certbot.timer || ls /etc/cron.d/certbot",
        `sudo install -Dm755 /dev/stdin /etc/letsencrypt/renewal-hooks/deploy/${input.certName}-nginx.sh <<'HOOK'\n${buildDeployHookScript(input)}HOOK`,
        "sudo certbot renew --dry-run",
      ],
    },
  ];
}
