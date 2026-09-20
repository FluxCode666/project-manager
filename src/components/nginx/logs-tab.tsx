"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";

interface LogFile {
  filename: string;
  size: number;
  modified: string;
}

export function LogsTab({ serverId }: { serverId: string }) {
  const [logs, setLogs] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("");
  const [lines, setLines] = useState("200");
  const [content, setContent] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/nginx/${serverId}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs ?? []);
        if (data.logs?.length && !selected) {
          setSelected(data.logs[0].filename);
        }
      } else {
        toast.error("加载日志列表失败");
      }
    } catch {
      toast.error("加载日志列表失败");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function readLog() {
    if (!selected) return;
    setReading(true);
    try {
      const n = Math.min(5000, Math.max(1, parseInt(lines) || 200));
      const res = await fetch(
        `/api/nginx/${serverId}/logs?file=${encodeURIComponent(selected)}&lines=${n}`,
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) setContent(data.content ?? "");
      else toast.error("读取日志失败", { description: data.error });
    } catch {
      toast.error("读取日志失败");
    } finally {
      setReading(false);
    }
  }

  function formatSize(bytes: number) {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-medium">日志查看</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> 刷新
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<FileText strokeWidth={1.5} />}
          title="未发现日志文件"
          description="服务器 /var/log/nginx/ 目录下没有 .log 文件。"
        />
      ) : (
        <>
          <Card>
            <CardContent>
              <div className="flex flex-wrap items-end gap-3 py-4">
                <div className="min-w-52 flex-1 space-y-1.5">
                  <label className="text-xs text-muted-foreground">日志文件</label>
                  <Select value={selected} onValueChange={(v) => v && setSelected(v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择日志文件" />
                    </SelectTrigger>
                    <SelectContent>
                      {logs.map((l) => (
                        <SelectItem key={l.filename} value={l.filename}>
                          {l.filename}（{formatSize(l.size)}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-28 space-y-1.5">
                  <label className="text-xs text-muted-foreground">行数</label>
                  <Input
                    type="number"
                    min={1}
                    max={5000}
                    value={lines}
                    onChange={(e) => setLines(e.target.value)}
                  />
                </div>
                <Button size="sm" onClick={readLog} disabled={reading || !selected}>
                  <Terminal className="size-4" aria-hidden="true" />
                  {reading ? "读取中..." : "读取"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="font-mono">{selected}</span>
                {content !== null && (
                  <span className="text-xs text-muted-foreground">
                    {content.split("\n").filter(Boolean).length} 行
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {content === null ? (
                <p className="text-sm text-muted-foreground">选择日志文件并点击「读取」。</p>
              ) : content === "" ? (
                <p className="text-sm text-muted-foreground">日志为空。</p>
              ) : (
                <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-xs leading-5">
                  {content}
                </pre>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
