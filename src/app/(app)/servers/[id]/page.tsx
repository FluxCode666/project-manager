import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  online: { label: "在线", variant: "default" },
  offline: { label: "离线", variant: "destructive" },
  maintenance: { label: "维护中", variant: "secondary" },
};

export default async function ServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const server = await db.server.findUnique({
    where: { id },
    include: {
      targets: {
        include: {
          environment: { include: { project: true } },
          _count: { select: { files: true } },
        },
      },
    },
  });
  if (!server) notFound();

  const st = STATUS_BADGE[server.status] ?? STATUS_BADGE.online;
  const hasCredential = server.sshAuthType === "password" ? !!server.sshPassword : !!server.sshPrivateKey;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{server.name}</h1>
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{server.provider || "未设置供应商"}</p>
        </div>
        <Link href="/servers" className={buttonVariants({ variant: "outline", size: "sm" })}>
          ← 返回列表
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">主机地址</span>
              <span className="font-mono">
                {server.host}:{server.port}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">SSH 用户</span>
              <span className="font-mono">{server.sshUser}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">认证方式</span>
              <span>{server.sshAuthType === "password" ? "密码" : "私钥"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">凭据状态</span>
              <Badge variant={hasCredential ? "default" : "destructive"}>
                {hasCredential ? "已配置" : "未配置"}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">操作系统</span>
              <span>{server.os || "未知"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">创建时间</span>
              <span>{new Date(server.createdAt).toLocaleString("zh-CN")}</span>
            </div>
            {server.notes && (
              <div className="border-t pt-3">
                <span className="text-muted-foreground">备注</span>
                <p className="mt-1 whitespace-pre-wrap">{server.notes}</p>
              </div>
            )}
            <div className="border-t pt-3">
              <Link href="/servers" className={buttonVariants({ variant: "outline", size: "sm" })}>
                编辑信息（在列表页操作）
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>部署目标（{server.targets.length}）</CardTitle>
          </CardHeader>
          <CardContent>
            {server.targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">该服务器尚未绑定任何项目的部署目标</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>项目 / 环境</TableHead>
                    <TableHead>部署目录</TableHead>
                    <TableHead>专属文件</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {server.targets.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link
                          href={`/projects/${t.environment.projectId}/env/${t.environmentId}`}
                          className="font-medium hover:underline"
                        >
                          {t.environment.project.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{t.environment.name}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{t.environment.deployPath}</TableCell>
                      <TableCell>{t._count.files}</TableCell>
                      <TableCell>
                        <Badge variant={t.enabled ? "default" : "outline"}>{t.enabled ? "启用" : "停用"}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
