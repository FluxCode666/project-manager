import Link from "next/link";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  active: { label: "运行中", variant: "default" },
  maintenance: { label: "维护中", variant: "secondary" },
  archived: { label: "已归档", variant: "outline" },
  online: { label: "在线", variant: "default" },
  offline: { label: "离线", variant: "destructive" },
};

export default async function DashboardPage() {
  const [projects, serverCount, envCount, recentLogs] = await Promise.all([
    db.project.findMany({
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { environments: true } } },
    }),
    db.server.count(),
    db.environment.count(),
    db.syncLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        deployTarget: { include: { server: true, environment: { include: { project: true } } } },
      },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">仪表盘</h1>
        <p className="text-sm text-muted-foreground">项目、服务器与部署同步总览</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">项目</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{projects.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">服务器</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{serverCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">部署环境</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{envCount}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>项目列表</CardTitle>
            <Link href="/projects" className={buttonVariants({ variant: "outline", size: "sm" })}>
              查看全部
            </Link>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                还没有项目，去{" "}
                <Link href="/projects" className="underline">
                  创建一个
                </Link>
              </p>
            ) : (
              <div className="space-y-3">
                {projects.slice(0, 6).map((p) => {
                  const st = STATUS_MAP[p.status] ?? STATUS_MAP.active;
                  return (
                    <Link
                      key={p.id}
                      href={`/projects/${p.id}`}
                      className="flex items-center justify-between rounded-md border px-3 py-2 hover:bg-muted/50"
                    >
                      <div>
                        <div className="text-sm font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {p._count.environments} 个环境 · {p.owner || "未指定负责人"}
                        </div>
                      </div>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>最近同步</CardTitle>
            <Link href="/logs" className={buttonVariants({ variant: "outline", size: "sm" })}>
              查看全部
            </Link>
          </CardHeader>
          <CardContent>
            {recentLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无同步记录</p>
            ) : (
              <div className="space-y-2">
                {recentLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate">
                        {log.deployTarget.environment.project.name} / {log.deployTarget.environment.name} →{" "}
                        {log.deployTarget.server.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString("zh-CN")} · {log.filesSynced} 个文件 ·{" "}
                        {log.durationMs}ms
                      </div>
                    </div>
                    <Badge variant={log.status === "success" ? "default" : "destructive"}>
                      {log.status === "success" ? "成功" : "失败"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
