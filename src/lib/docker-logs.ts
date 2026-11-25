import type { Client } from "ssh2";

// Docker 容器与日志：探测本机守护进程、按容器 ID 校验、限流读取日志、清理 json-file 日志文件。
// 安全边界：
// - 只接受完整 64 位十六进制容器 ID，不接受任意路径或自定义命令；
// - 只管理通过本机 Unix socket 访问的 Linux Docker（拒绝远端 context / DOCKER_HOST）；
// - 日志读取在远端 tail 与 SSH 读流两处限制行数与总字节数；
// - 清理只针对已停止容器，目标固定为 DockerRootDir/containers/<id>/<id>-json.log，
//   拒绝符号链接与非普通文件，且不停止/重启/删除容器。

export const CONTAINER_ID_RE = /^[0-9a-f]{64}$/;

/** 默认读取行数 */
export const DEFAULT_LOG_LINES = 200;
/** 允许读取的最大行数 */
export const MAX_LOG_LINES = 5000;
/** 单次读取远端日志的字节上限（远端 tail -c 与 SSH 读流双重限制） */
export const MAX_LOG_BYTES = 512 * 1024;

const LOG_STREAM_CAP = MAX_LOG_BYTES + 16 * 1024;
const LIST_STREAM_CAP = 4 * 1024 * 1024;
const AUX_STREAM_CAP = 256 * 1024;
const CLEAN_STREAM_CAP = 128 * 1024;
const MAX_STDERR_BYTES = 32 * 1024;

export function isValidContainerId(id: string): boolean {
  return CONTAINER_ID_RE.test(id);
}

/** 归一化并校验容器 ID：只保留完整 64 位十六进制，统一小写 */
export function normalizeContainerId(value: string): string | null {
  const id = value.trim().toLowerCase();
  return CONTAINER_ID_RE.test(id) ? id : null;
}

/** DockerRootDir 只接受无引号、无空白的绝对路径，拒绝 .. / . / // 等易绕过的写法 */
export function isValidDockerRootDir(root: string): boolean {
  if (!root.startsWith("/") || root === "/") return false;
  if (root.length > 240) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(root)) return false;
  const segments = root.split("/").slice(1);
  if (segments.some((s) => s === "" || s === "." || s === "..")) return false;
  return true;
}

export function expectedLogPath(rootDir: string, containerId: string): string {
  const root = rootDir.replace(/\/+$/, "");
  return `${root}/containers/${containerId}/${containerId}-json.log`;
}

/** 单引号包裹已校验的字面量，避免被远端 shell 解释 */
function shellQuoteStrict(value: string): string {
  if (!/^[A-Za-z0-9._/@:+-]+$/.test(value)) {
    throw new Error("内部错误：路径包含不允许的字符");
  }
  return `'${value}'`;
}

export function clampLogLines(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LOG_LINES;
  return Math.max(1, Math.min(Math.trunc(value), MAX_LOG_LINES));
}

// ---------------------------------------------------------------- SSH 执行

export interface RemoteScriptResult {
  stdout: string;
  stderr: string;
  code: number | null;
  truncated: boolean;
}

/**
 * 通过 SSH 执行固定脚本（脚本经 stdin 传给 sh -s，不拼接用户输入），
 * 同时在客户端限制读取字节数：超过上限立即关闭通道，避免远端异常输出打爆内存。
 */
export function runRemoteScript(
  conn: Client,
  script: string,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<RemoteScriptResult> {
  const maxBytes = options.maxBytes ?? AUX_STREAM_CAP;
  const timeoutMs = options.timeoutMs ?? 30000;
  const { promise, resolve, reject } = Promise.withResolvers<RemoteScriptResult>();

  conn.exec("sh -s", (err, stream) => {
    if (err) {
      reject(new Error("远端命令启动失败: " + err.message));
      return;
    }

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const closeQuietly = () => {
      try {
        stream.close();
      } catch {
        // 通道可能已经关闭，忽略
      }
    };

    const timer = setTimeout(() => {
      closeQuietly();
      finish(() => reject(new Error(`远端脚本执行超时（${timeoutMs}ms）`)));
    }, timeoutMs);

    stream.on("data", (chunk: Buffer) => {
      if (truncated) return;
      const remain = maxBytes - outBytes;
      if (chunk.length > remain) {
        if (remain > 0) outChunks.push(chunk.subarray(0, remain));
        outBytes = maxBytes;
        truncated = true;
        closeQuietly();
        return;
      }
      outChunks.push(chunk);
      outBytes += chunk.length;
    });

    stream.stderr.on("data", (chunk: Buffer) => {
      if (errBytes >= MAX_STDERR_BYTES) return;
      const remain = MAX_STDERR_BYTES - errBytes;
      const slice = chunk.length > remain ? chunk.subarray(0, remain) : chunk;
      errChunks.push(slice);
      errBytes += slice.length;
    });

    stream.on("error", (streamErr: Error) => {
      finish(() => reject(new Error("远端命令执行失败: " + streamErr.message)));
    });

    stream.on("close", (code: number | null) => {
      finish(() =>
        resolve({
          stdout: Buffer.concat(outChunks).toString("utf8"),
          stderr: Buffer.concat(errChunks).toString("utf8"),
          code,
          truncated,
        }),
      );
    });

    stream.end(script);
  });

  return promise;
}

// ---------------------------------------------------------------- 输出解析

function markerValue(stdout: string, marker: string): string | null {
  const line = stdout.split("\n").find((l) => l.startsWith(marker));
  return line === undefined ? null : line.slice(marker.length);
}

/** 取 marker 行之后的所有内容（用于可能包含换行的 docker 输出） */
function markerSection(stdout: string, marker: string): string | null {
  const lines = stdout.split("\n");
  const idx = lines.findIndex((l) => l.startsWith(marker));
  if (idx < 0) return null;
  return [lines[idx].slice(marker.length), ...lines.slice(idx + 1)].join("\n");
}

/** 取与 marker 完全一致的行的下一行起的所有内容 */
function linesAfterMarker(stdout: string, marker: string): string {
  const lines = stdout.split("\n");
  const idx = lines.findIndex((l) => l === marker);
  return idx < 0 ? "" : lines.slice(idx + 1).join("\n");
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Docker 的零值时间（0001-01-01T00:00:00Z）视为未发生 */
function normalizeTimestamp(value: string | null): string | null {
  if (!value || value.startsWith("0001-01-01")) return null;
  return value;
}

/** docker context inspect 的 Host 是 JSON 字符串（带引号），去掉引号后返回 */
function parseContextHost(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") return parsed.trim() || null;
  } catch {
    // 非 JSON（极旧版本）时按原文处理
  }
  return text;
}

/** 主机名比较：允许短名与 FQDN 的差异 */
function sameHost(a: string, b: string): boolean {
  const na = a.trim().toLowerCase().replace(/\.$/, "");
  const nb = b.trim().toLowerCase().replace(/\.$/, "");
  if (!na || !nb) return true;
  return na === nb || na.startsWith(nb + ".") || nb.startsWith(na + ".");
}

// ---------------------------------------------------------------- 探测

/** 环境层面的失败原因（Docker 不存在 / 权限 / 守护进程 / 远端 context / 平台） */
export type DockerEnvFailureStatus =
  | "docker_missing"
  | "permission_denied"
  | "daemon_error"
  | "remote_context"
  | "unsupported_platform";

export type DockerProbeStatus = "ok" | DockerEnvFailureStatus;

export interface DockerEnvInfo {
  serverVersion: string | null;
  rootDir: string | null;
  storageDriver: string | null;
  logDriver: string | null;
  osType: string | null;
  daemonName: string | null;
  hostname: string | null;
  contextHost: string | null;
  dockerHostEnv: string | null;
  /** 已确认是本机 Unix socket 且守护进程主机名与 SSH 主机一致 */
  localOnly: boolean;
}

export interface DockerProbe {
  status: DockerProbeStatus;
  message: string;
  env: DockerEnvInfo | null;
}

const PROBE_SCRIPT = `
if ! command -v docker >/dev/null 2>&1; then
  printf '__PM_STATUS__docker_missing\\n'
  exit 0
fi
printf '__PM_HOSTNAME__%s\\n' "$(hostname 2>/dev/null || uname -n 2>/dev/null || echo '')"
printf '__PM_DOCKER_HOST__%s\\n' "\${DOCKER_HOST:-}"
CTX=$(docker context inspect --format '{{json .Endpoints.docker.Host}}' 2>/dev/null) || CTX=""
printf '__PM_CONTEXT__%s\\n' "$CTX"
INFO=$(docker info --format '{{json .}}' 2>&1)
RC=$?
printf '__PM_INFO_RC__%s\\n' "$RC"
printf '__PM_INFO__%s\\n' "$INFO"
`;

function classifyInfoFailure(raw: string): { status: DockerProbeStatus; message: string } {
  const text = raw.trim();
  if (/permission denied/i.test(text)) {
    return {
      status: "permission_denied",
      message: "当前 SSH 用户没有访问 Docker 的权限（通常需要加入 docker 组，或改用 root 账号）",
    };
  }
  const brief = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" ");
  return {
    status: "daemon_error",
    message: brief ? `无法连接 Docker 守护进程：${brief.slice(0, 300)}` : "无法连接 Docker 守护进程",
  };
}

export async function probeDocker(conn: Client): Promise<DockerProbe> {
  const res = await runRemoteScript(conn, PROBE_SCRIPT, {
    maxBytes: AUX_STREAM_CAP,
    timeoutMs: 30000,
  });

  if (res.code !== 0) {
    return {
      status: "daemon_error",
      message: "Docker 探测失败: " + (res.stderr.trim() || `脚本退出码 ${res.code}`),
      env: null,
    };
  }

  if (markerValue(res.stdout, "__PM_STATUS__") === "docker_missing") {
    return {
      status: "docker_missing",
      message: "服务器上未找到 docker 命令，请确认 Docker 已安装并在 PATH 中可用",
      env: null,
    };
  }

  const hostname = (markerValue(res.stdout, "__PM_HOSTNAME__") ?? "").trim() || null;
  const dockerHostEnv = (markerValue(res.stdout, "__PM_DOCKER_HOST__") ?? "").trim() || null;
  const contextHost = parseContextHost(markerValue(res.stdout, "__PM_CONTEXT__") ?? "");

  const infoRcText = markerValue(res.stdout, "__PM_INFO_RC__");
  const infoRc = infoRcText === null ? NaN : Number.parseInt(infoRcText, 10);
  const infoRaw = (markerSection(res.stdout, "__PM_INFO__") ?? "").trim();

  if (infoRc !== 0) {
    const classified = classifyInfoFailure(infoRaw);
    return { status: classified.status, message: classified.message, env: null };
  }

  // docker info 的 JSON 可能被 stderr 的告警行包夹，取第一行可解析的对象
  let info: Record<string, unknown> | null = null;
  for (const line of infoRaw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      info = asRecord(JSON.parse(trimmed));
      break;
    } catch {
      // 继续尝试下一行
    }
  }
  if (!info) {
    return {
      status: "daemon_error",
      message: "无法解析 docker info 输出，请检查 Docker 版本",
      env: null,
    };
  }

  const env: DockerEnvInfo = {
    serverVersion: asString(info.ServerVersion),
    rootDir: asString(info.DockerRootDir),
    storageDriver: asString(info.Driver),
    logDriver: asString(info.LoggingDriver),
    osType: asString(info.OSType),
    daemonName: asString(info.Name),
    hostname,
    contextHost,
    dockerHostEnv,
    localOnly: false,
  };

  if (env.osType && env.osType.toLowerCase() !== "linux") {
    return {
      status: "unsupported_platform",
      message: `当前 Docker 为 ${env.osType} 平台，本功能只支持 Linux 原生 Docker`,
      env,
    };
  }

  if (env.dockerHostEnv && !env.dockerHostEnv.startsWith("unix://")) {
    return {
      status: "remote_context",
      message: `检测到 DOCKER_HOST=${env.dockerHostEnv}，远端 Docker 的日志文件不在本机，为避免写错文件已拒绝操作`,
      env,
    };
  }

  if (contextHost && !contextHost.startsWith("unix://")) {
    return {
      status: "remote_context",
      message: `当前 Docker context 指向 ${contextHost}（非本机 Unix socket），为避免在错误主机上清理文件已拒绝操作`,
      env,
    };
  }

  if (env.daemonName && hostname && !sameHost(env.daemonName, hostname)) {
    return {
      status: "remote_context",
      message: `Docker 守护进程主机（${env.daemonName}）与 SSH 主机（${hostname}）不一致，可能是远端 context，已拒绝操作`,
      env,
    };
  }

  if (!env.rootDir || !isValidDockerRootDir(env.rootDir)) {
    return {
      status: "unsupported_platform",
      message: "DockerRootDir 不是受支持的绝对路径，无法安全定位日志文件",
      env,
    };
  }

  env.localOnly = true;
  return {
    status: "ok",
    message: `Docker ${env.serverVersion ?? "未知版本"} · ${env.storageDriver ?? "未知驱动"}`,
    env,
  };
}

// ---------------------------------------------------------------- 容器列表

export interface DockerComposeInfo {
  project: string | null;
  service: string | null;
  configFiles: string | null;
  oneoff: boolean;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  running: boolean;
  exitCode: number | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  restartCount: number | null;
  logDriver: string | null;
  logPath: string | null;
  compose: DockerComposeInfo | null;
  /** 当前环境是否可以读取/清理该容器的日志文件（Linux + json-file） */
  supported: boolean;
  unsupportedReason: string | null;
}

export interface DockerContainerList {
  status: "ok" | "no_containers" | "failed";
  message: string;
  containers: DockerContainer[];
  truncated: boolean;
  parseErrors: number;
}

const CONTAINER_LIST_TEMPLATE =
  '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},' +
  '"state":{{json .State.Status}},"running":{{json .State.Running}},' +
  '"exitCode":{{json .State.ExitCode}},"created":{{json .Created}},' +
  '"startedAt":{{json .State.StartedAt}},"finishedAt":{{json .State.FinishedAt}},' +
  '"restartCount":{{json .RestartCount}},"logDriver":{{json .HostConfig.LogConfig.Type}},' +
  '"logPath":{{json .LogPath}},"labels":{{json .Config.Labels}}}';

function buildListScript(): string {
  return `
OUT=$(docker ps -aq --no-trunc 2>/dev/null)
RC=$?
if [ "$RC" -ne 0 ]; then
  printf '__PM_STATUS__ps_failed\\n'
  exit 0
fi
VALID=""
for i in $OUT; do
  case "$i" in
    *[!0-9a-f]*) continue ;;
  esac
  if [ \${#i} -ne 64 ]; then continue; fi
  VALID="$VALID $i"
done
if [ -z "$VALID" ]; then
  if [ -z "$OUT" ]; then
    printf '__PM_STATUS__no_containers\\n'
  else
    printf '__PM_STATUS__ps_failed\\n'
  fi
  exit 0
fi
printf '__PM_STATUS__ok\\n'
docker inspect --type container --format '${CONTAINER_LIST_TEMPLATE}' $VALID 2>/dev/null
printf '__PM_INSPECT_RC__%s\\n' "$?"
`;
}

function readCompose(labels: Record<string, unknown>): DockerComposeInfo | null {
  const project = asString(labels["com.docker.compose.project"]);
  const service = asString(labels["com.docker.compose.service"]);
  const configFiles = asString(labels["com.docker.compose.project.config_files"]);
  const oneoff = (asString(labels["com.docker.compose.oneoff"]) ?? "").toLowerCase() === "true";
  if (!project && !service && !configFiles) return null;
  return { project, service, configFiles, oneoff };
}

function parseContainerLine(line: string, osType: string | null): DockerContainer | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const obj = asRecord(parsed);
  const id = asString(obj.id);
  if (!id || !isValidContainerId(id)) return null;

  const rawName = asString(obj.name) ?? "";
  const name = rawName.replace(/^\//, "");
  const logDriver = asString(obj.logDriver);
  const platformOk = !osType || osType.toLowerCase() === "linux";
  const driverOk = logDriver === "json-file";
  const unsupportedReason = !platformOk
    ? "仅支持 Linux 原生容器"
    : !driverOk
      ? `日志驱动 ${logDriver ?? "未知"} 不支持直接读取/清理`
      : null;

  return {
    id,
    name: name || id.slice(0, 12),
    image: asString(obj.image) ?? "",
    state: asString(obj.state) ?? "unknown",
    running: asBoolean(obj.running) ?? false,
    exitCode: asNumber(obj.exitCode),
    createdAt: normalizeTimestamp(asString(obj.created)),
    startedAt: normalizeTimestamp(asString(obj.startedAt)),
    finishedAt: normalizeTimestamp(asString(obj.finishedAt)),
    restartCount: asNumber(obj.restartCount),
    logDriver,
    logPath: asString(obj.logPath) || null,
    compose: readCompose(asRecord(obj.labels)),
    supported: platformOk && driverOk,
    unsupportedReason,
  };
}

export async function listContainers(conn: Client, env: DockerEnvInfo): Promise<DockerContainerList> {
  const res = await runRemoteScript(conn, buildListScript(), {
    maxBytes: LIST_STREAM_CAP,
    timeoutMs: 45000,
  });

  if (res.code !== 0) {
    return {
      status: "failed",
      message: "读取容器列表失败: " + (res.stderr.trim() || `脚本退出码 ${res.code}`),
      containers: [],
      truncated: res.truncated,
      parseErrors: 0,
    };
  }

  const status = markerValue(res.stdout, "__PM_STATUS__");
  if (status === "no_containers") {
    return { status: "no_containers", message: "该服务器上没有任何容器（含已停止）", containers: [], truncated: false, parseErrors: 0 };
  }
  if (status !== "ok") {
    return {
      status: "failed",
      message: "docker ps 执行失败，无法列出容器",
      containers: [],
      truncated: res.truncated,
      parseErrors: 0,
    };
  }

  const containers: DockerContainer[] = [];
  let parseErrors = 0;
  for (const line of res.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("__PM_")) continue;
    const container = parseContainerLine(trimmed, env.osType);
    if (container) containers.push(container);
    else parseErrors++;
  }

  if (containers.length === 0) {
    return {
      status: "failed",
      message: "未解析到容器信息，Docker inspect 输出可能被截断或格式异常",
      containers: [],
      truncated: res.truncated,
      parseErrors,
    };
  }

  containers.sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;
    const pa = a.compose?.project ?? "";
    const pb = b.compose?.project ?? "";
    if (pa !== pb) return pa.localeCompare(pb);
    return a.name.localeCompare(b.name);
  });

  return {
    status: "ok",
    message: `共 ${containers.length} 个容器`,
    containers,
    truncated: res.truncated,
    parseErrors,
  };
}

// ---------------------------------------------------------------- 单容器校验

export interface DockerContainerDetail {
  id: string;
  name: string;
  image: string;
  state: string;
  running: boolean;
  exitCode: number | null;
  platform: string | null;
  logDriver: string | null;
  logPath: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** 按完整 ID 实时 inspect；返回 null 表示容器不存在（或 ID 与 Docker 返回不一致） */
export async function inspectContainer(conn: Client, containerId: string): Promise<DockerContainerDetail | null> {
  if (!isValidContainerId(containerId)) {
    throw new Error("容器 ID 必须是完整的 64 位十六进制字符串");
  }
  const idLiteral = shellQuoteStrict(containerId);
  const script = `
OUT=$(docker inspect --type container --format '{{json .}}' ${idLiteral} 2>/dev/null)
RC=$?
if [ "$RC" -ne 0 ] || [ -z "$OUT" ]; then
  printf '__PM_STATUS__not_found\\n'
  exit 0
fi
printf '__PM_STATUS__ok\\n'
printf '%s\\n' "$OUT"
`;

  const res = await runRemoteScript(conn, script, { maxBytes: AUX_STREAM_CAP, timeoutMs: 30000 });
  if (res.code !== 0) {
    throw new Error("读取容器信息失败: " + (res.stderr.trim() || `脚本退出码 ${res.code}`));
  }
  if (markerValue(res.stdout, "__PM_STATUS__") !== "ok") return null;

  const payload = linesAfterMarker(res.stdout, "__PM_STATUS__ok").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("无法解析 docker inspect 输出");
  }

  const obj = asRecord(parsed);
  const id = asString(obj.Id);
  if (!id || id !== containerId) return null;

  const state = asRecord(obj.State);
  const hostConfig = asRecord(obj.HostConfig);
  const logConfig = asRecord(hostConfig.LogConfig);
  const config = asRecord(obj.Config);

  return {
    id,
    name: (asString(obj.Name) ?? "").replace(/^\//, "") || containerId.slice(0, 12),
    image: asString(config.Image) ?? "",
    state: asString(state.Status) ?? "unknown",
    running: asBoolean(state.Running) ?? false,
    exitCode: asNumber(state.ExitCode),
    platform: asString(obj.Platform),
    logDriver: asString(logConfig.Type),
    logPath: asString(obj.LogPath) || null,
    createdAt: normalizeTimestamp(asString(obj.Created)),
    startedAt: normalizeTimestamp(asString(state.StartedAt)),
    finishedAt: normalizeTimestamp(asString(state.FinishedAt)),
  };
}

// ---------------------------------------------------------------- 日志读取

export type LogReadStatus =
  | "ok"
  | "empty"
  | "not_found"
  | "driver_unsupported"
  | "path_mismatch"
  | "unsafe_path"
  | "log_missing"
  | "failed"
  | DockerEnvFailureStatus;

export interface ContainerLogResult {
  status: LogReadStatus;
  message: string;
  containerId: string;
  content: string;
  lineCount: number;
  lines: number;
  bytes: number;
  sizeBytes: number | null;
  truncated: boolean;
  truncatedFirstLine: boolean;
  logPath: string | null;
  logDriver: string | null;
  platform: string | null;
}

function baseLogResult(containerId: string, lines: number): ContainerLogResult {
  return {
    status: "failed",
    message: "",
    containerId,
    content: "",
    lineCount: 0,
    lines,
    bytes: 0,
    sizeBytes: null,
    truncated: false,
    truncatedFirstLine: false,
    logPath: null,
    logDriver: null,
    platform: null,
  };
}

/**
 * 读取脚本：先解析 DockerRootDir 并确认日志文件位于标准位置（不在路径中穿过符号链接），
 * 远端 `tail -c` 限制字节、`tail -n` 限制行数，命令失败时返回失败标记而不是空内容。
 */
function buildReadScript(rootDir: string, id: string, lines: number): string {
  const rootLiteral = shellQuoteStrict(rootDir.replace(/\/+$/, ""));
  const idLiteral = shellQuoteStrict(id);
  const fileLiteral = shellQuoteStrict(expectedLogPath(rootDir, id));
  return `
ROOT=$(readlink -f ${rootLiteral} 2>/dev/null)
ID=${idLiteral}
FILE=${fileLiteral}
if [ -z "$ROOT" ]; then printf '__PM_STATUS__missing\\n'; exit 0; fi
if [ ! -e "$FILE" ]; then printf '__PM_STATUS__missing\\n'; exit 0; fi
if [ -h "$FILE" ]; then printf '__PM_STATUS__symlink\\n'; exit 0; fi
if [ ! -f "$FILE" ]; then printf '__PM_STATUS__type\\n'; exit 0; fi
FREAL=$(readlink -f "$FILE" 2>/dev/null)
if [ "$FREAL" != "$ROOT/containers/$ID/$ID-json.log" ]; then printf '__PM_STATUS__symlink\\n'; exit 0; fi
if [ ! -r "$FILE" ]; then printf '__PM_STATUS__unreadable\\n'; exit 0; fi
SIZE=$(stat -c %s "$FILE" 2>/dev/null) || SIZE=$(wc -c < "$FILE" 2>/dev/null)
SIZE=$(printf '%s' "$SIZE" | tr -cd '0-9'); [ -n "$SIZE" ] || SIZE=0
if [ "$SIZE" = "0" ] || [ ! -s "$FILE" ]; then printf '__PM_STATUS__empty\\n'; exit 0; fi
BYTES=$(tail -c ${MAX_LOG_BYTES} "$FILE")
BYTES_RC=$?
if [ "$BYTES_RC" -ne 0 ]; then printf '__PM_STATUS__read_failed\\n'; exit 0; fi
printf '__PM_META__%s\\n' "$SIZE"
printf '%s\\n' "$BYTES" | tail -n ${lines}
`;
}

export async function readContainerLogs(
  conn: Client,
  env: DockerEnvInfo,
  containerId: string,
  requestedLines: number,
): Promise<ContainerLogResult> {
  const lines = clampLogLines(requestedLines);
  const result = baseLogResult(containerId, lines);

  if (!isValidContainerId(containerId)) {
    return { ...result, status: "not_found", message: "容器 ID 必须是完整的 64 位十六进制字符串" };
  }

  if (!env.localOnly) {
    return { ...result, status: "remote_context", message: "Docker 未确认是本机 Unix socket，为避免读错文件已拒绝操作" };
  }

  const detail = await inspectContainer(conn, containerId);
  if (!detail) return { ...result, status: "not_found", message: "容器不存在或已被删除" };

  result.logDriver = detail.logDriver;
  result.platform = detail.platform;
  result.logPath = detail.logPath;

  if (detail.platform && detail.platform.toLowerCase() !== "linux") {
    return { ...result, status: "driver_unsupported", message: "仅支持 Linux 原生容器的日志" };
  }
  if (detail.logDriver !== "json-file") {
    return {
      ...result,
      status: "driver_unsupported",
      message: `容器使用 ${detail.logDriver ?? "未知"} 日志驱动，仅 json-file 支持直接读取日志文件`,
    };
  }
  if (!detail.logPath) {
    return { ...result, status: "driver_unsupported", message: "Docker 未返回日志路径，无法读取日志文件" };
  }
  const root = env.rootDir;
  if (!root || !isValidDockerRootDir(root)) {
    return { ...result, status: "failed", message: "DockerRootDir 异常，无法定位日志文件" };
  }
  const path = expectedLogPath(root, containerId);
  if (detail.logPath !== path) {
    return {
      ...result,
      status: "path_mismatch",
      message: "Docker 报告的日志路径与标准布局不一致，已拒绝读取",
    };
  }
  result.logPath = path;

  const res = await runRemoteScript(conn, buildReadScript(root, containerId, lines), {
    maxBytes: LOG_STREAM_CAP,
    timeoutMs: 30000,
  });

  if (res.code !== 0) {
    return {
      ...result,
      status: "failed",
      message: "读取日志失败: " + (res.stderr.trim() || `脚本退出码 ${res.code}`),
    };
  }

  const marker = markerValue(res.stdout, "__PM_STATUS__");
  if (marker === "missing") return { ...result, status: "log_missing", message: "容器日志文件不存在（可能从未写入或已被清理）" };
  if (marker === "symlink" || marker === "type") {
    return { ...result, status: "unsafe_path", message: "日志路径包含符号链接或不是普通文件，已拒绝读取" };
  }
  if (marker === "unreadable") {
    return { ...result, status: "permission_denied", message: "当前 SSH 用户没有读取该日志文件的权限" };
  }
  if (marker === "empty") {
    return { ...result, status: "empty", message: "日志文件为空", sizeBytes: 0 };
  }
  if (marker === "read_failed") {
    return { ...result, status: "failed", message: "读取日志文件失败（文件可能在读取时被删除）" };
  }

  const metaLine = res.stdout.split("\n").find((l) => l.startsWith("__PM_META__"));
  if (!metaLine) {
    return { ...result, status: "failed", message: "读取日志失败：远端未返回文件信息" };
  }
  const sizeText = metaLine.slice("__PM_META__".length).trim();
  const sizeBytes = /^\d+$/.test(sizeText) ? Number.parseInt(sizeText, 10) : null;
  result.sizeBytes = sizeBytes;

  const metaIdx = res.stdout.indexOf(metaLine);
  let content = res.stdout.slice(metaIdx + metaLine.length);
  if (content.startsWith("\n")) content = content.slice(1);

  let truncated = res.truncated || (sizeBytes !== null && sizeBytes > MAX_LOG_BYTES);
  let truncatedFirstLine = false;
  if (truncated && content.length > 0) {
    if (content.startsWith("\n")) {
      content = content.slice(1);
    } else {
      const nl = content.indexOf("\n");
      if (nl >= 0) {
        content = content.slice(nl + 1);
        truncatedFirstLine = true;
      }
      // 整段没有换行（超长单行）时保留内容，由 truncated 标记提示
    }
  }

  content = content.replace(/\u0000/g, "");
  if (content.length > MAX_LOG_BYTES) {
    content = content.slice(content.length - MAX_LOG_BYTES);
    truncated = true;
  }

  const lineCount = content === "" ? 0 : content.replace(/\n$/, "").split("\n").length;
  const bytes = Buffer.byteLength(content, "utf8");

  if (content === "" || lineCount === 0) {
    return {
      ...result,
      status: "empty",
      message: sizeBytes === 0 ? "日志文件为空" : "最近日志为空（可能刚被清空）",
      content: "",
      lineCount: 0,
      bytes: 0,
      truncated,
      truncatedFirstLine,
    };
  }

  return {
    ...result,
    status: "ok",
    message: `已读取最近 ${lineCount} 行${truncated ? `（已按 ${Math.round(MAX_LOG_BYTES / 1024)} KB 上限截断）` : ""}`,
    content,
    lineCount,
    bytes,
    truncated,
    truncatedFirstLine,
  };
}

// ---------------------------------------------------------------- 日志清理

export type CleanupStatus =
  | "ok"
  | "not_found"
  | "running"
  | "driver_unsupported"
  | "path_mismatch"
  | "unsafe_path"
  | "no_log"
  | "denied"
  | "failed"
  | DockerEnvFailureStatus;

export interface CleanupFileInfo {
  fileName: string;
  beforeBytes: number | null;
  afterBytes: number | null;
}

export interface LogCleanupResult {
  status: CleanupStatus;
  message: string;
  note: string;
  containerId: string;
  path: string | null;
  current: CleanupFileInfo | null;
  rotated: CleanupFileInfo[];
  rotatedSeen: number;
  rotatedSkipped: number;
  durationMs: number;
}

const CLEANUP_MESSAGES: Record<CleanupStatus, string> = {
  ok: "已清空容器日志",
  not_found: "容器不存在或已被删除",
  running: "容器正在运行，本功能只清理已停止容器的日志（避免与运行中的写入竞争）",
  driver_unsupported: "该容器未使用 json-file 日志驱动，无法直接清理日志文件",
  path_mismatch: "Docker 报告的日志路径与标准路径不一致，已拒绝清理",
  unsafe_path: "日志路径包含符号链接或不是普通文件，已拒绝清理",
  no_log: "容器日志文件不存在（可能从未写入或已被清理）",
  denied: "没有权限清空日志文件（需要 root 或对该文件有写权限的账号）",
  docker_missing: "服务器上未找到 docker 命令",
  permission_denied: "当前 SSH 用户没有访问 Docker 的权限（通常需要加入 docker 组，或改用 root 账号）",
  daemon_error: "无法连接 Docker 守护进程",
  remote_context: "Docker 指向非本机环境，已拒绝操作以避免在错误主机上清理文件",
  unsupported_platform: "当前环境不受支持（仅支持 Linux 原生 Docker）",
  failed: "清理日志失败",
};

/**
 * 清理脚本（失败关闭）：
 * 1) 实时 inspect 校验容器存在、完整 ID 一致、已停止、json-file 驱动、LogPath 与标准路径完全一致；
 * 2) 解析 DockerRootDir 后校验 containers/<id> 与日志文件均未经过符号链接且为普通文件；
 * 3) 只对文件做原地截断（不删除、不停止/重启容器），并对同目录 <id>-json.log.N 数字轮转文件做同样校验后截断。
 */
function buildCleanupScript(id: string, rootDir: string): string {
  const root = rootDir.replace(/\/+$/, "");
  const idLiteral = shellQuoteStrict(id);
  const rootLiteral = shellQuoteStrict(root);
  return `
ID=${idLiteral}
ROOT=${rootLiteral}
DIR="$ROOT/containers/$ID"
FILE="$DIR/$ID-json.log"
if ! command -v docker >/dev/null 2>&1; then printf '__PM_RES__docker_missing\\n'; exit 0; fi
CID=$(docker inspect --type container --format '{{.Id}}' "$ID" 2>/dev/null)
if [ -z "$CID" ] || [ "$CID" != "$ID" ]; then printf '__PM_RES__not_found\\n'; exit 0; fi
RUNNING=$(docker inspect --type container --format '{{.State.Running}}' "$ID" 2>/dev/null)
if [ -z "$RUNNING" ]; then printf '__PM_RES__not_found\\n'; exit 0; fi
if [ "$RUNNING" != "false" ]; then printf '__PM_RES__running\\n'; exit 0; fi
DRV=$(docker inspect --type container --format '{{.HostConfig.LogConfig.Type}}' "$ID" 2>/dev/null)
if [ "$DRV" != "json-file" ]; then printf '__PM_RES__driver_unsupported\\n'; printf '__PM_DRIVER__%s\\n' "$DRV"; exit 0; fi
LOG=$(docker inspect --type container --format '{{.LogPath}}' "$ID" 2>/dev/null)
if [ "$LOG" != "$FILE" ]; then printf '__PM_RES__path_mismatch\\n'; printf '__PM_LOGPATH__%s\\n' "$LOG"; exit 0; fi
RREAL=$(readlink -f "$ROOT" 2>/dev/null)
if [ -z "$RREAL" ] || [ ! -d "$DIR" ]; then printf '__PM_RES__no_log\\n'; exit 0; fi
if [ "$RREAL" != "$ROOT" ]; then printf '__PM_RES__unsafe_path\\n'; exit 0; fi
if [ -h "$DIR" ]; then printf '__PM_RES__unsafe_path\\n'; exit 0; fi
DREAL=$(readlink -f "$DIR" 2>/dev/null)
if [ "$DREAL" != "$RREAL/containers/$ID" ]; then printf '__PM_RES__unsafe_path\\n'; exit 0; fi
if [ ! -e "$FILE" ]; then printf '__PM_RES__no_log\\n'; exit 0; fi
if [ -h "$FILE" ] || [ ! -f "$FILE" ]; then printf '__PM_RES__unsafe_path\\n'; exit 0; fi
FREAL=$(readlink -f "$FILE" 2>/dev/null)
if [ "$FREAL" != "$RREAL/containers/$ID/$ID-json.log" ]; then printf '__PM_RES__unsafe_path\\n'; exit 0; fi
if [ "$(stat -c %h "$FILE" 2>/dev/null)" != 1 ]; then printf '__PM_RES__unsafe_path\\n'; exit 0; fi
BEFORE=$(stat -c %s "$FILE" 2>/dev/null) || BEFORE=$(wc -c < "$FILE" 2>/dev/null)
BEFORE=$(printf '%s' "$BEFORE" | tr -cd '0-9'); [ -n "$BEFORE" ] || BEFORE=0
if ! truncate -c -s 0 -- "$FILE" 2>/dev/null; then printf '__PM_RES__denied\\n'; exit 0; fi
AFTER=$(stat -c %s "$FILE" 2>/dev/null)
AFTER=$(printf '%s' "$AFTER" | tr -cd '0-9'); [ -n "$AFTER" ] || AFTER=0
printf '__PM_FILE__%s|%s|%s\\n' "$ID-json.log" "$BEFORE" "$AFTER"
ROTSEEN=0
ROTN=0
ROTSKIP=0
for f in "$DIR/$ID-json.log".[0-9]*; do
  if [ ! -e "$f" ]; then continue; fi
  ROTSEEN=$((ROTSEEN+1))
  if [ "$ROTSEEN" -gt 20 ]; then ROTSKIP=$((ROTSKIP+1)); continue; fi
  base=\${f##*/}
  suffix=\${base#"$ID-json.log".}
  case "$suffix" in
    ''|*[!0-9]*) ROTSKIP=$((ROTSKIP+1)); continue ;;
  esac
  if [ \${#suffix} -gt 3 ]; then ROTSKIP=$((ROTSKIP+1)); continue; fi
  if [ -h "$f" ] || [ ! -f "$f" ]; then ROTSKIP=$((ROTSKIP+1)); continue; fi
  FREAL2=$(readlink -f "$f" 2>/dev/null)
  if [ "$FREAL2" != "$RREAL/containers/$ID/$base" ]; then ROTSKIP=$((ROTSKIP+1)); continue; fi
  if [ "$(stat -c %h "$f" 2>/dev/null)" != 1 ]; then ROTSKIP=$((ROTSKIP+1)); continue; fi
  b=$(stat -c %s "$f" 2>/dev/null)
  b=$(printf '%s' "$b" | tr -cd '0-9'); [ -n "$b" ] || b=0
  if truncate -c -s 0 -- "$f" 2>/dev/null; then
    a=$(stat -c %s "$f" 2>/dev/null)
    a=$(printf '%s' "$a" | tr -cd '0-9'); [ -n "$a" ] || a=0
    printf '__PM_ROT__%s|%s|%s\\n' "$base" "$b" "$a"
    ROTN=$((ROTN+1))
  else
    ROTSKIP=$((ROTSKIP+1))
  fi
done
printf '__PM_ROT_STAT__%s|%s|%s\\n' "$ROTSEEN" "$ROTN" "$ROTSKIP"
printf '__PM_RES__ok\\n'
`;
}

function parseSize(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

function parseCleanupFile(line: string, marker: string): CleanupFileInfo | null {
  const raw = line.slice(marker.length);
  const [fileName, before, after] = raw.split("|");
  if (!fileName) return null;
  return { fileName, beforeBytes: parseSize(before), afterBytes: parseSize(after) };
}

export async function cleanupContainerLogs(
  conn: Client,
  env: DockerEnvInfo,
  containerId: string,
): Promise<LogCleanupResult> {
  const startedAt = Date.now();
  const base: LogCleanupResult = {
    status: "failed",
    message: "",
    note: "",
    containerId,
    path: null,
    current: null,
    rotated: [],
    rotatedSeen: 0,
    rotatedSkipped: 0,
    durationMs: 0,
  };

  if (!isValidContainerId(containerId)) {
    return { ...base, status: "not_found", message: "容器 ID 必须是完整的 64 位十六进制字符串" };
  }
  if (!env.localOnly) {
    return { ...base, status: "remote_context", message: "Docker 未确认是本机 Unix socket，为避免写错文件已拒绝操作" };
  }
  const root = env.rootDir;
  if (!root || !isValidDockerRootDir(root)) {
    return { ...base, status: "failed", message: "DockerRootDir 异常，无法安全定位日志文件" };
  }

  const expected = expectedLogPath(root, containerId);
  base.path = expected;

  const res = await runRemoteScript(conn, buildCleanupScript(containerId, root), {
    maxBytes: CLEAN_STREAM_CAP,
    timeoutMs: 60000,
  });

  if (res.code !== 0) {
    return {
      ...base,
      status: "failed",
      message: "清理脚本执行失败: " + (res.stderr.trim() || `退出码 ${res.code}`),
      durationMs: Date.now() - startedAt,
    };
  }
  if (res.truncated) {
    return {
      ...base,
      status: "failed",
      message: "清理结果超出传输上限，已中止（未继续处理其余文件）",
      durationMs: Date.now() - startedAt,
    };
  }

  const statusMarker = markerValue(res.stdout, "__PM_RES__");
  const status = (statusMarker ?? "") as CleanupStatus;
  if (!(status in CLEANUP_MESSAGES)) {
    return {
      ...base,
      status: "failed",
      message: "清理失败：远端未返回可识别的结果" + (res.stderr.trim() ? `（${res.stderr.trim()}）` : ""),
      durationMs: Date.now() - startedAt,
    };
  }

  if (status !== "ok") {
    let message = CLEANUP_MESSAGES[status];
    if (status === "driver_unsupported") {
      const driver = markerValue(res.stdout, "__PM_DRIVER__");
      if (driver) message = `容器使用 ${driver} 日志驱动，仅支持 json-file`;
    }
    if (status === "path_mismatch") {
      const reported = markerValue(res.stdout, "__PM_LOGPATH__");
      if (reported) message = `Docker 报告的日志路径（${reported}）与标准路径不一致，已拒绝清理`;
    }
    return {
      ...base,
      status,
      message,
      note: status === "running" ? "容器正在运行，未做任何修改" : "未对任何文件做修改",
      durationMs: Date.now() - startedAt,
    };
  }

  const lines = res.stdout.split("\n");
  const currentLine = lines.find((l) => l.startsWith("__PM_FILE__"));
  const current = currentLine ? parseCleanupFile(currentLine, "__PM_FILE__") : null;
  if (!current) {
    return { ...base, status: "failed", message: "清理结果不完整：未找到当前日志文件信息", durationMs: Date.now() - startedAt };
  }

  const rotated: CleanupFileInfo[] = [];
  for (const line of lines) {
    if (!line.startsWith("__PM_ROT__")) continue;
    const info = parseCleanupFile(line, "__PM_ROT__");
    if (info) rotated.push(info);
  }

  const rotStat = markerValue(res.stdout, "__PM_ROT_STAT__");
  let rotatedSeen = rotated.length;
  let rotatedSkipped = 0;
  if (rotStat) {
    const [seen, , skipped] = rotStat.split("|");
    rotatedSeen = parseSize(seen) ?? rotated.length;
    rotatedSkipped = parseSize(skipped) ?? 0;
  }

  const parts: string[] = [
    `已清空当前日志文件 ${current.fileName}（${current.beforeBytes ?? 0} B → ${current.afterBytes ?? 0} B）`,
  ];
  if (rotated.length > 0) {
    parts.push(`并清空 ${rotated.length} 个标准轮转文件（${rotated.map((r) => r.fileName).join("、")}）`);
  } else if (rotatedSeen === 0) {
    parts.push(`未发现 ${containerId}-json.log.N 标准轮转文件，若存在其他形式的归档日志仍会保留`);
  } else {
    parts.push(`发现的 ${rotatedSeen} 个轮转候选均未清空，历史轮转日志仍会保留`);
  }
  if (rotatedSkipped > 0) {
    parts.push(`${rotatedSkipped} 个文件因超出数量上限或安全检查未通过被跳过`);
  }
  parts.push("不会停止/重启容器，清理后日志不可恢复");

  return {
    status: "ok",
    message: "已清空容器日志",
    note: parts.join("；"),
    containerId,
    path: expected,
    current,
    rotated,
    rotatedSeen,
    rotatedSkipped,
    durationMs: Date.now() - startedAt,
  };
}
