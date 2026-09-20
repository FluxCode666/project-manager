import Link from "next/link";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Globe, Server } from "lucide-react";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  online: { label: "在线", variant: "default" },
  offline: { label: "离线", variant: "destructive" },
  maintenance: { label: "维护中", variant: "secondary" },
};

export default async function NginxPage() {
  const servers = await db.server.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { nginxSites: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <h1 className="text-2xl font-semibold">Nginx 管理</h1>
          <p className="text-sm text-muted-foreground">
            选择一台服务器，管理它的 nginx 配置、站点、模块、日志与统计
          </p>
        </div>
      </div>

      <Card>
        <CardContent>
          {servers.length === 0 ? (
            <EmptyState
              icon={<Server strokeWidth={1.5} />}
              title="还没有服务器"
              description="请先在「服务器」页面添加服务器资产，之后即可在这里管理它的 nginx。"
              action={
                <Link href="/servers">
                  <Button>
                    <Server className="size-4" aria-hidden="true" /> 前往添加服务器
                  </Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y">
              {servers.map((s) => {
                const st = STATUS_BADGE[s.status] ?? STATUS_BADGE.online;
                return (
                  <li key={s.id}>
                    <Link
                      href={`/nginx/${s.id}`}
                      className="flex items-center gap-4 px-2 py-4 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/10 bg-gradient-to-br from-[#eef3e4] to-[#f8faf3] text-primary/70">
                        <Globe className="size-5" strokeWidth={1.5} aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{s.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {s.host}:{s.port} · {s.sshUser}
                        </p>
                      </div>
                      <Badge variant="outline">{s._count.nginxSites} 个站点</Badge>
                      <Badge variant={st.variant}>{st.label}</Badge>
                      <span className="text-sm text-primary">进入管理 →</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
