"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { ServerFormDialog, type ServerData } from "@/components/server-form-dialog";
import { toast } from "sonner";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  online: { label: "在线", variant: "default" },
  offline: { label: "离线", variant: "destructive" },
  maintenance: { label: "维护中", variant: "secondary" },
};

export default function ServersPage() {
  const [servers, setServers] = useState<ServerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ServerData | null>(null);
  const [deleting, setDeleting] = useState<ServerData | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/servers");
    if (res.ok) setServers(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleTest(server: ServerData) {
    setTestingId(server.id);
    toast.info(`正在测试 ${server.name} ...`);
    try {
      const res = await fetch(`/api/servers/${server.id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        toast.success(`${server.name} 连接成功`, { description: data.message });
      } else {
        toast.error(`${server.name} 连接失败`, { description: data.message });
      }
      load();
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    const res = await fetch(`/api/servers/${deleting.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("服务器已删除");
      setDeleting(null);
      load();
    } else {
      toast.error("删除失败");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">服务器</h1>
          <p className="text-sm text-muted-foreground">团队服务器资产与 SSH 凭据管理</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          + 添加服务器
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : servers.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有服务器，点击右上角「添加服务器」开始
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>主机</TableHead>
                  <TableHead>SSH 用户</TableHead>
                  <TableHead>认证</TableHead>
                  <TableHead>部署目标</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {servers.map((s) => {
                  const st = STATUS_BADGE[s.status ?? "online"] ?? STATUS_BADGE.online;
                  const targetCount = (s as ServerData & { _count?: { targets: number } })._count?.targets ?? 0;
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link href={`/servers/${s.id}`} className="font-medium hover:underline">
                          {s.name}
                        </Link>
                        {s.provider && (
                          <div className="text-xs text-muted-foreground">{s.provider}</div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {s.host}:{s.port}
                      </TableCell>
                      <TableCell>{s.sshUser}</TableCell>
                      <TableCell>{s.sshAuthType === "password" ? "密码" : "私钥"}</TableCell>
                      <TableCell>{targetCount}</TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={testingId === s.id}
                            onClick={() => handleTest(s)}
                          >
                            {testingId === s.id ? "测试中..." : "测试连接"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(s);
                              setDialogOpen(true);
                            }}
                          >
                            编辑
                          </Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(s)}>
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ServerFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        server={editing}
        onSaved={load}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除服务器「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将同时删除该服务器的 SSH 凭据及其所有部署目标关联，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={handleDelete}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
