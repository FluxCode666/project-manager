"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PackageCheck, PackagePlus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";

interface DetectedModule {
  filename: string;
  soPath: string;
  name: string;
  loaded: boolean;
  catalog?: {
    name: string;
    description: string;
    apt?: string;
    dnf?: string;
  };
}

interface ModuleReport {
  version: string | null;
  builtin: string[];
  addons: string[];
  dynamic: DetectedModule[];
  packageManager: "apt" | "dnf" | "yum" | null;
}

// 常见第三方模块目录（与后端保持一致，用于「可安装」列表）
const CATALOG = [
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

export function ModulesTab({ serverId }: { serverId: string }) {
  const [report, setReport] = useState<ModuleReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // soPath 或 catalog name

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/nginx/${serverId}/modules`);
      if (res.ok) setReport(await res.json());
      else toast.error("探测模块失败");
    } catch {
      toast.error("探测模块失败");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(body: Record<string, unknown>, busyKey: string, okMsg: string) {
    setBusy(busyKey);
    try {
      const res = await fetch(`/api/nginx/${serverId}/modules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        toast.success(okMsg);
      } else {
        toast.error("操作失败", { description: data.output || data.error });
      }
      load();
    } catch {
      toast.error("操作请求失败");
    } finally {
      setBusy(null);
    }
  }

  const dynamic = report?.dynamic ?? [];
  const pm = report?.packageManager ?? null;

  // 可安装的目录项（磁盘上尚未检测到对应 .so）
  const installable = CATALOG.filter((c) => {
    const found = dynamic.some((d) => d.catalog?.name === c.name);
    if (found) return false;
    return pm ? !!(pm === "apt" ? c.apt : c.dnf ?? c.apt) : false;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">第三方模块管理</h2>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> 重新探测
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                编译进 nginx 的模块（{report?.builtin.length ?? 0}）
                {report?.version && <span className="ml-2 font-mono text-xs text-muted-foreground">nginx/{report.version}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report?.builtin.length ? (
                <div className="flex flex-wrap gap-2">
                  {report.builtin.map((m) => (
                    <Badge key={m} variant="secondary" className="font-mono text-xs">
                      {m}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">未解析到静态编译模块</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">动态模块（.so）</CardTitle>
            </CardHeader>
            <CardContent>
              {dynamic.length === 0 ? (
                <EmptyState
                  icon={<PackageCheck strokeWidth={1.5} />}
                  title="未检测到动态模块"
                  description="服务器上未发现可加载的 .so 动态模块文件。可在下方通过包管理器安装第三方模块。"
                />
              ) : (
                <ul className="divide-y">
                  {dynamic.map((d) => (
                    <li key={d.soPath} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-sm">{d.filename}</p>
                        <p className="truncate text-xs text-muted-foreground">{d.soPath}</p>
                        {d.catalog && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {d.catalog.name} · {d.catalog.description}
                          </p>
                        )}
                      </div>
                      <Badge variant={d.loaded ? "default" : "outline"}>{d.loaded ? "已加载" : "未加载"}</Badge>
                      <Button
                        variant={d.loaded ? "outline" : "default"}
                        size="sm"
                        disabled={busy === d.soPath}
                        onClick={() =>
                          runAction(
                            { action: d.loaded ? "disable" : "enable", soPath: d.soPath },
                            d.soPath,
                            d.loaded ? "已卸载模块" : "已加载模块",
                          )
                        }
                      >
                        {busy === d.soPath ? "处理中..." : d.loaded ? "卸载" : "加载"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {installable.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">可安装的第三方模块（{pm ?? "未检测到包管理器"}）</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {installable.map((c) => {
                    const pkg = pm === "apt" ? c.apt : c.dnf ?? c.apt;
                    return (
                      <li key={c.name} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.description}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === c.name || !pkg}
                          onClick={() => {
                            if (!pkg) return;
                            runAction({ action: "install", pkg }, c.name, `已安装 ${c.name}，可重新探测后加载`);
                          }}
                        >
                          <PackagePlus className="size-4" aria-hidden="true" />
                          {busy === c.name ? "安装中..." : `安装（${pkg}）`}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
