"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw, Terminal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { DockerContainer } from "@/lib/docker-logs";

const LINE_OPTIONS = ["100", "200", "500", "1000", "2000"] as const;
const DEFAULT_LINES = "200";

interface LogMeta {
  lineCount: number;
  bytes: number;
  sizeBytes: number | null;
  truncated: boolean;
  truncatedFirstLine: boolean;
  logPath: string | null;
  logDriver: string | null;
}

interface LogApiResponse {
  status?: string;
  message?: string;
  content?: string;
  lineCount?: number;
  bytes?: number;
  sizeBytes?: number | null;
  truncated?: boolean;
  truncatedFirstLine?: boolean;
  logPath?: string | null;
  logDriver?: string | null;
  error?: string;
}

interface CleanupApiResponse {
  status?: string;
  message?: string;
  note?: string;
  error?: string;
}

type ViewState = "loading" | "ok" | "empty" | "status" | "error";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "未知";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function parseLineCount(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 200;
}

export function ContainerLogs({ serverId, container }: { serverId: string; container: DockerContainer }) {
  const [lineOption, setLineOption] = useState<string>(DEFAULT_LINES);
  const [view, setView] = useState<ViewState>("loading");
  const [message, setMessage] = useState("");
  const [content, setContent] = useState("");
  const [meta, setMeta] = useState<LogMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const logsUrl = useCallback(
    (lineCount: number) =>
      `/api/docker/${encodeURIComponent(serverId)}/logs?containerId=${container.id}&lines=${lineCount}`,
    [serverId, container.id],
  );

  const applyPayload = useCallback((data: LogApiResponse, requestId: number) => {
    if (requestId !== requestRef.current) return;
    if (data.status === "ok") {
      const text = typeof data.content === "string" ? data.content : "";
      setMeta({
        lineCount: typeof data.lineCount === "number" ? data.lineCount : 0,
        bytes: typeof data.bytes === "number" ? data.bytes : 0,
        sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : null,
        truncated: Boolean(data.truncated),
        truncatedFirstLine: Boolean(data.truncatedFirstLine),
        logPath: data.logPath ?? null,
        logDriver: data.logDriver ?? null,
      });
      setContent(text);
      setMessage("");
      setView(text === "" ? "empty" : "ok");
      return;
    }
    if (data.status === "empty") {
      setMeta({
        lineCount: 0,
        bytes: 0,
        sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : null,
        truncated: Boolean(data.truncated),
        truncatedFirstLine: false,
        logPath: data.logPath ?? null,
        logDriver: data.logDriver ?? null,
      });
      setContent("");
      setMessage("");
      setView("empty");
      return;
    }
    setView("status");
    setMessage(data.message || "无法读取该容器的日志");
  }, []);

  // 首次进入自动读取一次（setState 只发生在异步回调中）
  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestRef.current;

    fetch(logsUrl(parseLineCount(DEFAULT_LINES)), { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as LogApiResponse;
        if (cancelled || requestId !== requestRef.current) return;
        if (!res.ok) {
          setView("error");
          setMessage(data.error || `请求失败（${res.status}）`);
          return;
        }
        applyPayload(data, requestId);
      })
      .catch((e: Error) => {
        if (cancelled || requestId !== requestRef.current) return;
        setView("error");
        setMessage(e.message);
      })
      .finally(() => {
        if (!cancelled && requestId === requestRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [logsUrl, applyPayload]);

  async function reloadLogs(lineCount: number) {
    const requestId = ++requestRef.current;
    setLoading(true);
    setView("loading");
    setMessage("");
    setMeta(null);
    setContent("");

    try {
      const res = await fetch(logsUrl(lineCount), { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as LogApiResponse;
      if (requestId !== requestRef.current) return;
      if (!res.ok) {
        setView("error");
        setMessage(data.error || `请求失败（${res.status}）`);
        return;
      }
      applyPayload(data, requestId);
    } catch (e) {
      if (requestId !== requestRef.current) return;
      setView("error");
      setMessage((e as Error).message);
    } finally {
      if (requestId === requestRef.current && mountedRef.current) setLoading(false);
    }
  }

  const cleanupBlockedReason = container.running
    ? "容器正在运行，仅支持清理已停止容器的日志"
    : !container.supported
      ? container.unsupportedReason ?? "该容器的日志驱动不支持直接清理"
      : null;

  const logPath = meta?.logPath ?? container.logPath;

  async function handleCleanup() {
    if (cleaning) return;
    setCleaning(true);
    try {
      const res = await fetch(`/api/docker/${encodeURIComponent(serverId)}/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerId: container.id }),
      });
      const data = (await res.json().catch(() => ({}))) as CleanupApiResponse;
      if (!res.ok) {
        toast.error("清理日志失败", {
          description: data.error || `请求失败（${res.status}）`,
        });
        return;
      }
      if (data.status === "ok") {
        toast.success("日志已清空", { description: data.note });
        void reloadLogs(parseLineCount(lineOption));
      } else {
        toast.error("未清理日志", { description: data.message || "未知原因" });
      }
    } catch (e) {
      toast.error("清理日志失败", { description: (e as Error).message });
    } finally {
      if (mountedRef.current) {
        setCleaning(false);
        setConfirmOpen(false);
      }
    }
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 truncate">{container.name}</span>
          <Badge variant={container.running ? "default" : "outline"}>
            {container.running ? "运行中" : "已停止"}
          </Badge>
          <span className="font-mono text-xs font-normal text-muted-foreground">
            {container.id.slice(0, 12)}
          </span>
          <span className="text-xs font-normal text-muted-foreground">{container.image}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28 space-y-1.5">
            <label className="text-xs text-muted-foreground" htmlFor="docker-log-lines">
              行数
            </label>
            <Select value={lineOption} onValueChange={(v) => v && setLineOption(String(v))}>
              <SelectTrigger id="docker-log-lines" className="w-full" size="sm">
                <SelectValue placeholder="行数" />
              </SelectTrigger>
              <SelectContent>
                {LINE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option} 行
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void reloadLogs(parseLineCount(lineOption))}
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            {loading ? "读取中..." : "读取日志"}
          </Button>

          <Button
            variant="destructive"
            size="sm"
            className="ml-auto"
            onClick={() => setConfirmOpen(true)}
            disabled={cleaning || Boolean(cleanupBlockedReason)}
            title={cleanupBlockedReason ?? "清空当前容器日志文件（不可恢复）"}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {cleaning ? "清理中..." : "清理日志"}
          </Button>
        </div>

        {cleanupBlockedReason && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {cleanupBlockedReason}
          </p>
        )}

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Terminal className="size-3.5" aria-hidden="true" />
              日志驱动 {meta?.logDriver ?? container.logDriver ?? "未知"}
            </span>
            <span>文件大小 {formatBytes(meta?.sizeBytes ?? null)}</span>
            {view === "ok" && <span>{meta?.lineCount ?? 0} 行</span>}
            {meta?.truncated && <span className="text-amber-600">已按字节上限截断</span>}
            {meta?.truncatedFirstLine && <span className="text-amber-600">首行可能不完整</span>}
          </div>
          {logPath && <p className="break-all font-mono text-[11px] text-muted-foreground">{logPath}</p>}
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-48" />
          </div>
        ) : view === "ok" ? (
          <pre className="max-h-[48vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-xs leading-5">
            {content}
          </pre>
        ) : view === "empty" ? (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            日志为空（可能刚被清空，或该容器尚未产生输出）。
          </p>
        ) : view === "status" ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {message}
          </div>
        ) : (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {message || "读取日志失败"}
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !cleaning && setConfirmOpen(open)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空「{container.name}」的日志？</AlertDialogTitle>
            <AlertDialogDescription>
              将清空容器日志文件{logPath ? ` ${logPath}` : ""}，操作不可恢复（已写入的日志无法找回）。
              不会停止、重启或删除容器；仅支持已停止的 json-file 容器，同目录下的标准轮转文件
              （&lt;容器ID&gt;-json.log.N）若存在会一并清空，其他形式的归档日志仍会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cleaning}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              disabled={cleaning}
              onClick={() => void handleCleanup()}
            >
              {cleaning ? "清理中..." : "确认清空"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
