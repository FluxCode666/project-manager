"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Activity, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";

interface NginxStats {
  sampledLines: number;
  parseErrors: number;
  totalRequests: number;
  statusCodes: Record<string, number>;
  topPaths: { path: string; count: number }[];
  topIps: { ip: string; count: number }[];
  methodCounts: Record<string, number>;
  totalBytes: number;
  errors: number;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

const STATUS_COLORS: Record<string, string> = {
  "2xx": "bg-emerald-500",
  "3xx": "bg-sky-500",
  "4xx": "bg-amber-500",
  "5xx": "bg-red-500",
};

export function StatsTab({ serverId }: { serverId: string }) {
  const [lines, setLines] = useState("10000");
  const [stats, setStats] = useState<NginxStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const n = Math.min(100000, Math.max(100, parseInt(lines) || 10000));
      const res = await fetch(`/api/nginx/${serverId}/stats?lines=${n}`);
      if (res.ok) setStats(await res.json());
      else toast.error("统计失败");
    } catch {
      toast.error("统计失败");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxStatus = Math.max(1, ...Object.values(stats?.statusCodes ?? { "2xx": 1 }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-medium">访问统计</h2>
        <p className="text-xs text-muted-foreground">基于 access.log 尾部抽样解析</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min={100}
            max={100000}
            value={lines}
            onChange={(e) => setLines(e.target.value)}
            className="w-28"
            aria-label="抽样行数"
          />
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            {loading ? "统计中..." : "统计"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : !stats || stats.totalRequests === 0 ? (
        <EmptyState
          icon={<Activity strokeWidth={1.5} />}
          title="暂无访问数据"
          description="access.log 中没有可解析的请求记录，或日志格式非 combined 格式。"
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">请求总数</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">
                {stats.totalRequests.toLocaleString()}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">传输流量</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">
                {formatBytes(stats.totalBytes)}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">错误（5xx）</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums text-destructive">
                {stats.errors.toLocaleString()}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm text-muted-foreground">抽样行数</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">
                {stats.sampledLines.toLocaleString()}
                {stats.parseErrors > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    无法解析 {stats.parseErrors} 行
                  </span>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">状态码分布</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(["2xx", "3xx", "4xx", "5xx"] as const).map((bucket) => {
                const count = stats.statusCodes[bucket] ?? 0;
                const pct = stats.totalRequests ? (count / stats.totalRequests) * 100 : 0;
                return (
                  <div key={bucket} className="flex items-center gap-3">
                    <Badge variant="outline" className="w-12 justify-center font-mono">
                      {bucket}
                    </Badge>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className={`h-full ${STATUS_COLORS[bucket]}`}
                        style={{ width: `${(count / maxStatus) * 100}%` }}
                      />
                    </div>
                    <span className="w-20 text-right text-sm tabular-nums">{count.toLocaleString()}</span>
                    <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">请求方法</CardTitle>
              </CardHeader>
              <CardContent>
                {Object.keys(stats.methodCounts).length === 0 ? (
                  <p className="text-sm text-muted-foreground">无数据</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(stats.methodCounts).map(([m, c]) => (
                      <Badge key={m} variant="secondary" className="font-mono text-xs">
                        {m} · {c.toLocaleString()}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">访问最多的路径（Top 10）</CardTitle>
              </CardHeader>
              <CardContent>
                {stats.topPaths.length === 0 ? (
                  <p className="text-sm text-muted-foreground">无数据</p>
                ) : (
                  <ul className="divide-y">
                    {stats.topPaths.slice(0, 10).map((p) => (
                      <li key={p.path} className="flex items-center justify-between gap-3 py-2">
                        <span className="truncate font-mono text-xs">{p.path}</span>
                        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{p.count.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">访问最多的来源 IP（Top 10）</CardTitle>
            </CardHeader>
            <CardContent>
              {stats.topIps.length === 0 ? (
                <p className="text-sm text-muted-foreground">无数据</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {stats.topIps.slice(0, 10).map((ip) => (
                    <li key={ip.ip} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                      <span className="truncate font-mono text-xs">{ip.ip}</span>
                      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{ip.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
