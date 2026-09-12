"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { ProjectFormDialog, type ProjectData } from "@/components/project-form-dialog";
import { toast } from "sonner";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  active: { label: "运行中", variant: "default" },
  maintenance: { label: "维护中", variant: "secondary" },
  archived: { label: "已归档", variant: "outline" },
};

type ProjectWithCount = ProjectData & { _count: { environments: number } };

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectData | null>(null);
  const [deleting, setDeleting] = useState<ProjectWithCount | null>(null);

  async function load() {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete() {
    if (!deleting) return;
    const res = await fetch(`/api/projects/${deleting.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("项目已删除");
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
          <h1 className="text-2xl font-semibold">项目</h1>
          <p className="text-sm text-muted-foreground">管理团队所有项目及其部署环境</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          + 创建项目
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : projects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            还没有项目，点击右上角「创建项目」开始
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            const st = STATUS_BADGE[p.status] ?? STATUS_BADGE.active;
            return (
              <Card key={p.id} className="transition-shadow hover:shadow-md">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <Link href={`/projects/${p.id}`} className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold hover:underline">{p.name}</h3>
                      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-muted-foreground">
                        {p.description || "暂无描述"}
                      </p>
                    </Link>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                    <div>
                      {p.owner || "未指定负责人"} · {p._count.environments} 个环境
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(p);
                          setDialogOpen(true);
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setDeleting(p)}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ProjectFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        project={editing}
        onSaved={() => load()}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除项目「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将同时删除该项目的所有环境、部署文件配置与同步日志，此操作不可撤销。
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
