"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CircleAlert, Container as ContainerIcon, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import type { DockerContainer, DockerEnvInfo } from "@/lib/docker-logs";
import { ContainerLogs } from "./container-logs";

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "status"; status: string; message: string }
  | { kind: "ready"; env: DockerEnvInfo; containers: DockerContainer[]; truncated: boolean };

const ENV_FAILURE_HINTS: Record<string, { title: string; description: string; icon: ReactNode }> = {
  docker_missing: {
    title: "未安装 Docker",
    description: "该服务器上找不到 docker 命令，请确认 Docker 已安装且 PATH 对 SSH 用户可见。",
    icon: <ContainerIcon strokeWidth={1.5} />,
  },
  permission_denied: {
    title: "没有 Docker 权限",
    description: "当前 SSH 用户无权访问 Docker socket，请将其加入 docker 组或使用有权限的账号。",
    icon: <ShieldAlert strokeWidth={1.5} />,
  },
  daemon_error: {
    title: "无法连接 Docker",
    description: "Docker 守护进程未运行、不可达或返回了异常信息。",
    icon: <CircleAlert strokeWidth={1.5} />,
  },
  remote_context: {
    title: "Docker 指向其他主机",
    description: "检测到远端 Docker context 或 DOCKER_HOST；为避免在错误主机上读写日志，已拒绝操作。",
    icon: <ShieldAlert strokeWidth={1.5} />,
  },
  unsupported_platform: {
    title: "环境不受支持",
    description: "本功能只支持 Linux 原生 Docker（本机 Unix socket + json-file 日志驱动）。",
    icon: <CircleAlert strokeWidth={1.5} />,
  },
};

const CONTAINER_STATE_BADGE: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  running: { label: "运行中", variant: "default" },
  exited: { label: "已停止", variant: "outline" },
  created: { label: "已创建", variant: "outline" },
  paused: { label: "已暂停", variant: "secondary" },
  restarting: { label: "重启中", variant: "secondary" },
  dead: { label: "异常", variant: "destructive" },
  removing: { label: "删除中", variant: "secondary" },
};

export function DockerManager({ serverId }: { serverId: string }) {
  const [state, setState] = useState<ListState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/docker/${encodeURIComponent(serverId)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setState({
            kind: "error",
            message: typeof data.error === "string" ? data.error : `请求失败（${res.status}）`,
          });
          return;
        }
        const status = typeof data.status === "string" ? data.status : "daemon_error";
        if (status === "no_containers") {
          setState({
            kind: "ready",
            env: data.env as DockerEnvInfo,
            containers: [],
            truncated: false,
          });
          return;
        }
        if (status !== "ok") {
          setState({
            kind: "status",
            status,
            message: typeof data.message === "string" ? data.message : "",
          });
          return;
        }
        setState({
          kind: "ready",
          env: data.env as DockerEnvInfo,
          containers: Array.isArray(data.containers) ? (data.containers as DockerContainer[]) : [],
          truncated: Boolean(data.truncated),
        });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ kind: "error", message: e.message });
      });

    return () => {
      cancelled = true;
    };
  }, [serverId, reloadKey]);

  const containers = useMemo(
    () => (state.kind === "ready" ? state.containers : []),
    [state],
  );

  // 选中的容器随列表刷新自动回退到第一个，无需在 effect 里同步 state
  const effectiveSelectedId = useMemo(() => {
    if (containers.length === 0) return null;
    if (selectedId && containers.some((c) => c.id === selectedId)) return selectedId;
    return containers[0].id;
  }, [containers, selectedId]);

  const selected = useMemo(
    () => containers.find((c) => c.id === effectiveSelectedId) ?? null,
    [containers, effectiveSelectedId],
  );

  const refresh = useCallback(() => {
    setState({ kind: "loading" });
    setReloadKey((k) => k + 1);
  }, []);

  if (state.kind === "loading") {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10" />
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm text-destructive">读取 Docker 容器失败：{state.message}</p>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="size-4" aria-hidden="true" /> 重试
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === "status") {
    const hint = ENV_FAILURE_HINTS[state.status] ?? {
      title: "Docker 不可用",
      description: "该服务器上的 Docker 不可用。",
      icon: <CircleAlert strokeWidth={1.5} />,
    };
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={hint.icon}
            title={hint.title}
            description={state.message || hint.description}
            action={
              <Button variant="outline" size="sm" onClick={refresh}>
                <RefreshCw className="size-4" aria-hidden="true" /> 重新检测
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Docker {state.env.serverVersion ?? "未知版本"}</Badge>
        <Badge variant="outline">存储驱动 {state.env.storageDriver ?? "未知"}</Badge>
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={state.env.rootDir ?? ""}>
          {state.env.rootDir}
        </span>
        <Button className="ml-auto" variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="size-4" aria-hidden="true" /> 刷新
        </Button>
      </div>

      {state.truncated && (
        <p className="text-xs text-muted-foreground">
          容器较多，列表输出已按传输上限截断；如缺少目标容器请提高上限或改用 CLI 查看。
        </p>
      )}

      {containers.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<ContainerIcon strokeWidth={1.5} />}
              title="没有容器"
              description="该服务器上没有任何容器（包括已停止的容器）。"
              action={
                <Button variant="outline" size="sm" onClick={refresh}>
                  <RefreshCw className="size-4" aria-hidden="true" /> 刷新
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <Card size="sm" className="lg:sticky lg:top-4">
            <CardHeader>
              <CardTitle className="text-sm">容器（{containers.length}）</CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <ul className="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
                {containers.map((c) => {
                  const badge = CONTAINER_STATE_BADGE[c.state] ?? { label: c.state, variant: "outline" as const };
                  const active = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSelectedId(c.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                          active
                            ? "border-primary/30 bg-primary/5"
                            : "border-transparent hover:border-border hover:bg-muted/60"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.image || "未知镜像"}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span className="font-mono">{c.id.slice(0, 12)}</span>
                          {c.compose?.project && (
                            <span className="truncate">
                              {c.compose.project}
                              {c.compose.service ? ` / ${c.compose.service}` : ""}
                            </span>
                          )}
                          <span>{c.logDriver ?? "日志驱动未知"}</span>
                          {c.exitCode !== null && !c.running && <span>退出码 {c.exitCode}</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {selected ? (
            <ContainerLogs key={selected.id} serverId={serverId} container={selected} />
          ) : (
            <Card>
              <CardContent>
                <p className="py-10 text-center text-sm text-muted-foreground">选择左侧容器查看最近日志。</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
