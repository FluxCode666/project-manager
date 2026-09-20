import { Client } from "ssh2";
import { sshExec, sftpWriteFile, sftpReadFile } from "@/lib/ssh";

// ---- 常量 ----
export const NGINX_CONF_DIR = "/etc/nginx";
export const NGINX_CONF_D = "/etc/nginx/conf.d";
export const NGINX_LOG_DIR = "/var/log/nginx";
export const NGINX_MODULES_ENABLED = "/etc/nginx/modules-enabled";

// 常见动态模块目录（按发行版差异罗列，探测时逐个尝试）
const MODULE_DIRS = [
  "/usr/lib/nginx/modules",
  "/usr/lib64/nginx/modules",
  "/etc/nginx/modules",
  "/usr/local/nginx/modules",
];

// 第三方模块目录（用于「安装缺失模块」提示与一键安装）
export interface NginxModuleCatalogEntry {
  name: string; // 展示名
  description: string;
  apt?: string; // Debian/Ubuntu 包名
  dnf?: string; // RHEL/CentOS 包名
  match: string[]; // 用于匹配 .so 文件名（子串，小写）
}

export const NGINX_MODULE_CATALOG: NginxModuleCatalogEntry[] = [
  { name: "headers-more", description: "修改/删除响应头", apt: "libnginx-mod-http-headers-more-filter", dnf: "nginx-mod-http-headers-more-filter", match: ["headers_more"] },
  { name: "brotli", description: "Brotli 压缩", apt: "libnginx-mod-http-brotli-filter", dnf: "nginx-mod-http-brotli-filter", match: ["brotli"] },
  { name: "njs", description: "JavaScript 脚本能力", apt: "libnginx-mod-http-js", dnf: "nginx-mod-http-js", match: ["http_js", "njs"] },
  { name: "geoip2", description: "GeoIP2 地理信息", apt: "libnginx-mod-http-geoip2", dnf: "nginx-mod-http-geoip2", match: ["geoip2"] },
  { name: "image-filter", description: "图片缩放/裁剪", apt: "libnginx-mod-http-image-filter", dnf: "nginx-mod-http-image-filter", match: ["image_filter"] },
  { name: "perl", description: "Perl 脚本", apt: "libnginx-mod-http-perl", dnf: "nginx-mod-http-perl", match: ["http_perl"] },
  { name: "xslt", description: "XSLT 转换", apt: "libnginx-mod-http-xslt-filter", dnf: "nginx-mod-http-xslt-filter", match: ["xslt"] },
  { name: "dav-ext", description: "WebDAV 扩展方法", apt: "libnginx-mod-http-dav-ext", dnf: "nginx-mod-http-dav-ext", match: ["dav_ext"] },
  { name: "auth-pam", description: "PAM 认证", apt: "libnginx-mod-http-auth-pam", dnf: "nginx-mod-http-auth-pam", match: ["auth_pam"] },
  { name: "fancyindex", description: "美化目录列表", apt: "libnginx-mod-http-fancyindex", dnf: "nginx-mod-http-fancyindex", match: ["fancyindex"] },
  { name: "echo", description: "调试 echo 指令", apt: "libnginx-mod-http-echo", dnf: "nginx-mod-http-echo", match: ["http_echo"] },
  { name: "rtmp", description: "RTMP 流媒体", apt: "libnginx-mod-rtmp", dnf: "nginx-mod-rtmp", match: ["rtmp"] },
  { name: "upstream-fair", description: "upstream 公平调度", apt: "libnginx-mod-http-upstream-fair", match: ["upstream_fair"] },
  { name: "cache-purge", description: "缓存清理", apt: "libnginx-mod-http-cache-purge", match: ["cache_purge"] },
  { name: "lua", description: "Lua 脚本", apt: "libnginx-mod-http-lua", dnf: "nginx-mod-http-lua", match: ["http_lua"] },
  { name: "set-misc", description: "set 扩展指令", apt: "libnginx-mod-http-set-misc", match: ["set_misc"] },
  { name: "subs-filter", description: "响应体替换", apt: "libnginx-mod-http-subs-filter", dnf: "nginx-mod-http-subs-filter", match: ["subs_filter"] },
];

// ---- 纯函数：解析 ----

// 解析 `nginx -v` / `nginx -V` 输出的版本行，如 "nginx version: nginx/1.18.0 (Ubuntu)"
export function parseNginxVersion(output: string): string | null {
  const m = output.match(/nginx\/\s*([^\s)]+)/);
  return m ? m[1] : null;
}

// 解析 configure arguments，返回干净的模块标识列表（--with-xxx / --add-module=xxx）
export function parseConfigureArgs(output: string): { builtin: string[]; addons: string[] } {
  const builtin: string[] = [];
  const addons: string[] = [];
  const line = output
    .split("\n")
    .find((l) => l.startsWith("configure arguments:")) ?? "";
  const args = line.replace(/^configure arguments:\s*/, "").trim().split(/\s+/).filter(Boolean);

  for (const arg of args) {
    if (arg.startsWith("--with-")) {
      // --with-http_ssl_module、--with-stream、--with-threads 等
      if (arg.endsWith("_module") || /^--with-(stream|mail|threads|file-aio|http_v2|http_v3)$/.test(arg) || arg.endsWith("_module=")) {
        builtin.push(arg.replace(/^--with-/, "").replace(/[=].*$/, ""));
      }
    } else if (arg.startsWith("--add-module=") || arg.startsWith("--add-dynamic-module=")) {
      const name = arg.split("=")[1]?.split("/").pop() ?? "";
      if (name) addons.push(name);
    }
  }
  return { builtin, addons };
}

// 解析 access.log（combined 格式）单行
// $remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"
const ACCESS_LOG_RE =
  /^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"\s*$/;

export interface NginxStats {
  sampledLines: number;
  parseErrors: number;
  totalRequests: number;
  statusCodes: Record<string, number>; // 2xx / 3xx / 4xx / 5xx
  topPaths: { path: string; count: number }[];
  topIps: { ip: string; count: number }[];
  methodCounts: Record<string, number>;
  totalBytes: number;
  errors: number;
}

export function parseAccessLog(text: string): NginxStats {
  const lines = text.split("\n");
  const statusCodes: Record<string, number> = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
  const pathCounts = new Map<string, number>();
  const ipCounts = new Map<string, number>();
  const methodCounts: Record<string, number> = {};
  let totalRequests = 0;
  let totalBytes = 0;
  let errors = 0;
  let parseErrors = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(ACCESS_LOG_RE);
    if (!m) {
      parseErrors++;
      continue;
    }
    const [, , , request, status, bytes] = m;
    const code = parseInt(status, 10);
    const byteCount = parseInt(bytes, 10) || 0;

    totalRequests++;
    totalBytes += byteCount;
    if (code >= 500) errors++;

    const bucket = code >= 500 ? "5xx" : code >= 400 ? "4xx" : code >= 300 ? "3xx" : "2xx";
    statusCodes[bucket]++;

    const parts = request.split(/\s+/);
    const method = parts[0] ?? "UNKNOWN";
    methodCounts[method] = (methodCounts[method] ?? 0) + 1;

    // 路径取 request 中不含 query 的部分
    const rawPath = parts[1] ?? "";
    const path = rawPath.split("?")[0] || "/";
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);

    const ip = m[1];
    ipCounts.set(ip, (ipCounts.get(ip) ?? 0) + 1);
  }

  const top = <T>(map: Map<T, number>, n: number): { key: string; count: number }[] =>
    Array.from(map.entries())
      .map(([k, count]) => ({ key: String(k), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n);

  return {
    sampledLines: lines.length,
    parseErrors,
    totalRequests,
    statusCodes,
    topPaths: top(pathCounts, 10).map(({ key, count }) => ({ path: key, count })),
    topIps: top(ipCounts, 10).map(({ key, count }) => ({ ip: key, count })),
    methodCounts,
    totalBytes,
    errors,
  };
}

// ---- 工具 ----

// 站点名/配置文件名安全校验：仅允许字母数字、点、下划线、连字符
export function isValidSiteName(name: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(name) && !name.includes("..");
}

// 从 .so 绝对路径取干净模块名（去目录、去 .so 后缀）
export function cleanModuleName(soPath: string): string {
  return soPath.split("/").pop()?.replace(/\.so$/, "") ?? soPath;
}

// ---- SSH 操作 ----

export async function nginxVersion(conn: Client): Promise<string | null> {
  const { stdout, stderr } = await sshExec(conn, "nginx -v 2>&1");
  return parseNginxVersion(`${stdout}\n${stderr}`) ?? parseNginxVersion(stdout) ?? null;
}

// nginx -t 配置校验
export async function nginxTestConfig(conn: Client): Promise<{ ok: boolean; output: string }> {
  const { stdout, stderr, code } = await sshExec(conn, "nginx -t 2>&1");
  const output = [stdout, stderr].filter(Boolean).join("\n").trim();
  return { ok: code === 0, output: output || (code === 0 ? "configuration file test is successful" : "未知错误") };
}

// 重载 nginx：优先 nginx -s reload，失败则 systemctl reload
export async function nginxReload(conn: Client): Promise<{ ok: boolean; output: string }> {
  const direct = await sshExec(conn, "nginx -s reload 2>&1");
  if (direct.code === 0) {
    return { ok: true, output: direct.stderr || direct.stdout || "已重载" };
  }
  const systemd = await sshExec(conn, "systemctl reload nginx 2>&1");
  if (systemd.code === 0) {
    return { ok: true, output: systemd.stdout || systemd.stderr || "已重载（systemctl）" };
  }
  return {
    ok: false,
    output: [direct.stderr, systemd.stderr].filter(Boolean).join("\n") || "重载失败",
  };
}

// nginx 运行状态 + 版本 + 配置校验
export interface NginxStatus {
  version: string | null;
  running: boolean;
  configTest: { ok: boolean; output: string };
  processLines: string[];
}

export async function nginxStatus(conn: Client): Promise<NginxStatus> {
  const [version, configTest, active, procs] = await Promise.all([
    nginxVersion(conn),
    nginxTestConfig(conn),
    sshExec(conn, "systemctl is-active nginx 2>/dev/null || (pgrep -x nginx >/dev/null && echo running || echo stopped)"),
    sshExec(conn, "ps -eo pid,etime,cmd 2>/dev/null | grep -E '[n]ginx: (master|worker)' | head -8"),
  ]);
  const activeText = active.stdout.trim();
  const running = activeText === "active" || activeText === "running";
  const processLines = procs.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  return { version, running, configTest, processLines };
}

// 读取主配置 /etc/nginx/nginx.conf
export async function nginxReadMainConfig(conn: Client): Promise<string | null> {
  return sftpReadFile(conn, `${NGINX_CONF_DIR}/nginx.conf`);
}

// 列出 conf.d 下的文件（含 .disabled 后缀）
export interface RemoteSiteFile {
  filename: string;
  enabled: boolean;
}

export async function nginxListRemoteSites(conn: Client): Promise<RemoteSiteFile[]> {
  const { stdout } = await sshExec(conn, `ls -1 ${NGINX_CONF_D} 2>/dev/null`);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((f) => f.endsWith(".conf") || f.endsWith(".conf.disabled"))
    .map((filename) => ({
      filename,
      enabled: !filename.endsWith(".disabled"),
    }));
}

// 站点在 conf.d 中的文件名（启用为 <name>.conf，禁用为 <name>.conf.disabled）
function siteFilename(name: string, enabled: boolean): string {
  return enabled ? `${name}.conf` : `${name}.conf.disabled`;
}

// 写入站点：先删掉另一种状态的同名文件，再写目标文件
export async function nginxWriteSite(conn: Client, name: string, content: string, enabled: boolean): Promise<void> {
  if (!isValidSiteName(name)) throw new Error("站点名称只能包含字母、数字、点、下划线、连字符");
  const target = `${NGINX_CONF_D}/${siteFilename(name, enabled)}`;
  const opposite = `${NGINX_CONF_D}/${siteFilename(name, !enabled)}`;
  // 移除相反状态的同名文件，避免同名文件同时存在（*.conf 会被 include，*.disabled 不会）
  await sshExec(conn, `rm -f ${opposite}`);
  await sshExec(conn, `mkdir -p ${NGINX_CONF_D}`);
  await sftpWriteFile(conn, target, content);
}

// 启用/禁用站点（通过重命名后缀实现）
export async function nginxSetSiteEnabled(conn: Client, name: string, enabled: boolean): Promise<void> {
  if (!isValidSiteName(name)) throw new Error("站点名称不合法");
  const from = `${NGINX_CONF_D}/${siteFilename(name, !enabled)}`;
  const to = `${NGINX_CONF_D}/${siteFilename(name, enabled)}`;
  await sshExec(conn, `[ -f ${from} ] && mv ${from} ${to} || true`);
}

// 删除站点（无论启用/禁用状态都清掉）
export async function nginxDeleteSite(conn: Client, name: string): Promise<void> {
  if (!isValidSiteName(name)) throw new Error("站点名称不合法");
  await sshExec(conn, `rm -f ${NGINX_CONF_D}/${name}.conf ${NGINX_CONF_D}/${name}.conf.disabled`);
}

// ---- 模块探测 ----

export interface DetectedModule {
  filename: string; // .so 文件名
  soPath: string; // 绝对路径
  name: string; // 干净模块名
  loaded: boolean; // 是否已通过 load_module 加载
  catalog?: NginxModuleCatalogEntry; // 匹配到的目录条目
}

export interface NginxModuleReport {
  version: string | null;
  builtin: string[]; // 编译进 nginx 的静态模块（--with-xxx）
  addons: string[]; // --add-module / --add-dynamic-module 的源码目录名
  dynamic: DetectedModule[]; // 磁盘上的动态 .so 模块
}

export async function nginxDetectModules(conn: Client): Promise<NginxModuleReport> {
  const v = await sshExec(conn, "nginx -V 2>&1");
  const version = parseNginxVersion(`${v.stdout}\n${v.stderr}`);
  const { builtin, addons } = parseConfigureArgs(`${v.stdout}\n${v.stderr}`);

  // 已加载的 load_module 路径（优先 nginx -T 有效配置，兜底读 modules-enabled）
  const loadedPaths = new Set<string>();
  const loaded = await sshExec(conn, "nginx -T 2>&1 | grep -E '^load_module' 2>/dev/null");
  for (const line of loaded.stdout.split("\n")) {
    const m = line.match(/load_module\s+["']?([^"';]+)["']?/);
    if (m) loadedPaths.add(m[1].trim());
  }

  // 磁盘上的 .so 动态模块
  const dirs = MODULE_DIRS.map((d) => `${d}/*.so`).join(" ");
  const soOut = await sshExec(conn, `ls ${dirs} 2>/dev/null`);
  const dynamic: DetectedModule[] = soOut.stdout
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((soPath) => {
      const filename = soPath.split("/").pop() ?? soPath;
      const name = cleanModuleName(soPath);
      const lower = filename.toLowerCase();
      const catalog = NGINX_MODULE_CATALOG.find((c) => c.match.some((k) => lower.includes(k)));
      return {
        filename,
        soPath,
        name,
        loaded: Array.from(loadedPaths).some((p) => p === soPath || p.endsWith(`/${filename}`) || p.includes(`/${filename}`)),
        catalog,
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));

  return { version, builtin, addons, dynamic };
}

// 启用动态模块：写入 load_module（绝对路径），优先 modules-enabled，否则注入 nginx.conf 主上下文
export async function nginxEnableModule(conn: Client, soPath: string): Promise<{ ok: boolean; output: string }> {
  const filename = soPath.split("/").pop();
  if (!filename) return { ok: false, output: "模块路径无效" };
  const loadLine = `load_module ${soPath};`;

  // 判断 modules-enabled 是否被主配置 include
  const check = await sshExec(conn, `nginx -T 2>&1 | grep -q '${NGINX_MODULES_ENABLED}' && echo yes || echo no`);
  if (check.stdout.trim() === "yes") {
    const name = cleanModuleName(soPath);
    await sshExec(conn, `mkdir -p ${NGINX_MODULES_ENABLED}`);
    await sftpWriteFile(conn, `${NGINX_MODULES_ENABLED}/${name}.conf`, `${loadLine}\n`);
  } else {
    // 注入主配置主上下文：读取 nginx.conf，在第一个 events/http/mail/stream 块前插入
    const confPath = `${NGINX_CONF_DIR}/nginx.conf`;
    const existing = await sftpReadFile(conn, confPath);
    if (existing == null) return { ok: false, output: "无法读取 /etc/nginx/nginx.conf" };
    if (existing.includes(loadLine)) {
      return { ok: false, output: "该模块已在 nginx.conf 中加载" };
    }
    const lines = existing.split("\n");
    const insertAt = lines.findIndex((l) => /^\s*(events|http|mail|stream)\s*\{/.test(l));
    const marker = "# load_module (managed by project-manager)";
    const markerIdx = lines.findIndex((l) => l.includes("managed by project-manager"));
    if (markerIdx >= 0) {
      lines.splice(markerIdx + 1, 0, loadLine);
    } else {
      const idx = insertAt >= 0 ? insertAt : 1;
      lines.splice(idx, 0, marker, loadLine, "");
    }
    await sftpWriteFile(conn, confPath, lines.join("\n"));
  }

  // 校验并重载
  const test = await nginxTestConfig(conn);
  if (!test.ok) return { ok: false, output: `配置校验失败：\n${test.output}` };
  const reload = await nginxReload(conn);
  return reload;
}

// 禁用动态模块：移除 modules-enabled 下的 conf 或 nginx.conf 中的 load_module 行
export async function nginxDisableModule(conn: Client, soPath: string): Promise<{ ok: boolean; output: string }> {
  const name = cleanModuleName(soPath);
  const confPath = `${NGINX_MODULES_ENABLED}/${name}.conf`;
  const rm = await sshExec(conn, `rm -f ${confPath} && echo removed || echo notfound`);

  if (rm.stdout.trim() !== "removed") {
    // 尝试从 nginx.conf 移除
    const mainConf = `${NGINX_CONF_DIR}/nginx.conf`;
    const existing = await sftpReadFile(conn, mainConf);
    if (existing != null) {
      const lines = existing.split("\n").filter((l) => !l.includes(`load_module ${soPath}`));
      await sftpWriteFile(conn, mainConf, lines.join("\n"));
    }
  }

  const test = await nginxTestConfig(conn);
  if (!test.ok) return { ok: false, output: `配置校验失败：\n${test.output}` };
  return nginxReload(conn);
}

// 检测包管理器（apt-get / dnf / yum）
export async function nginxDetectPackageManager(conn: Client): Promise<"apt" | "dnf" | "yum" | null> {
  const out = await sshExec(conn, "command -v apt-get || command -v dnf || command -v yum 2>/dev/null");
  const first = out.stdout.trim().split("\n")[0] ?? "";
  if (first.includes("apt-get")) return "apt";
  if (first.includes("dnf")) return "dnf";
  if (first.includes("yum")) return "yum";
  return null;
}

// 一键安装模块包
export async function nginxInstallModule(
  conn: Client,
  pkg: string,
  pm: "apt" | "dnf" | "yum",
): Promise<{ ok: boolean; output: string }> {
  let cmd = "";
  if (pm === "apt") cmd = `DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg}`;
  else cmd = `${pm} install -y ${pkg}`;
  const out = await sshExec(conn, cmd, 300000);
  return { ok: out.code === 0, output: [out.stdout, out.stderr].filter(Boolean).join("\n") };
}

// ---- 日志 ----

// 列出 /var/log/nginx 下的 .log 文件
export async function nginxListLogs(conn: Client): Promise<string[]> {
  const { stdout } = await sshExec(conn, `ls -1 ${NGINX_LOG_DIR} 2>/dev/null`);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((f) => f.endsWith(".log"));
}

// 读取日志尾部 N 行
export async function nginxTailLog(conn: Client, filename: string, lines = 200): Promise<string> {
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) throw new Error("日志文件名不合法");
  const { stdout } = await sshExec(conn, `tail -n ${Math.max(1, Math.min(lines, 5000))} ${NGINX_LOG_DIR}/${filename} 2>&1`);
  return stdout;
}

// 统计：解析 access.log 尾部 N 行
export async function nginxStats(conn: Client, lines = 10000): Promise<NginxStats> {
  const text = await nginxTailLog(conn, "access.log", lines);
  return parseAccessLog(text);
}
