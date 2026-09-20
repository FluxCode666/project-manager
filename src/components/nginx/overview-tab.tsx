"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, RotateCw, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface NginxStatus {
  version: string | null;
  running: boolean;
  configTest: { ok: boolean; output: string };
  processLines: string[];
}

export function OverviewTab({ serverId }: { serverId: string }) {
  const [status, setStatus] = useState<NginxStatus | null>(null);
  const [mainConfig, setMainConfig] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, cRes] = await Promise.all([
        fetch(`/api/nginx/${serverId}/status`),
        fetch(`/api/nginx/${serverId}/config`),
      ]);
      if (sRes.ok) setStatus(await sRes.json());
      else setStatus(null);
      if (cRes.ok) {
        const c = await cRes.json();
        setMainConfig(c.content);
        setConfigError(null);
      } else {
        const c = await cRes.json().catch(() => ({}));
        setMainConfig(null);
        setConfigError(c.error || "无法读取主配置");
      }
    } catch {
      toast.error("加载 nginx 状态失败");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleReload() {
    setReloading(true);
    try {
      const res = await fetch(`/api/nginx/${serverId}/status`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        toast.success("nginx 已重载", { description: data.output });
      } else {
        toast.error("重载失败", { description: data.output || data.error });
      }
      load();
    } catch {
      toast.error("重载请求失败");
    } finally {
      setReloading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-medium">运行状态</h2>
          {status && (
            <Badge variant={status.running ? "default" : "destructive"}>
              {status.running ? "运行中" : "未运行"}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> 刷新
          </Button>
          <Button size="sm" onClick={handleReload} disabled={reloading}>
            <RotateCw className={`size-4 ${reloading ? "animate-spin" : ""}`} aria-hidden="true" />
            {reloading ? "重载中..." : "校验并重载"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>基本信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">版本</span>
                <span className="font-mono">{status?.version ?? "未知"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">运行状态</span>
                <Badge variant={status?.running ? "default" : "destructive"}>
                  {status?.running ? "运行中" : "未运行"}
                </Badge>
              </div>
              <div className="border-t pt-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">配置校验（nginx -t）</span>
                  <Badge variant={status?.configTest.ok ? "default" : "destructive"}>
                    {status?.configTest.ok ? "通过" : "失败"}
                  </Badge>
                </div>
                {status?.configTest.output && (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                    {status.configTest.output}
                  </pre>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>nginx 进程</CardTitle>
            </CardHeader>
            <CardContent>
              {status && status.processLines.length > 0 ? (
                <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs leading-6">
                  {status.processLines.join("\n")}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">未检测到 nginx master/worker 进程</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4" aria-hidden="true" /> 主配置 /etc/nginx/nginx.conf
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mainConfig ? (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-xs leading-6">
              {mainConfig}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">{configError || "无法读取主配置"}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
