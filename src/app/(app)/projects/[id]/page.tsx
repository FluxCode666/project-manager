"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface EnvironmentData {
  id: string;
  projectId: string;
  name: string;
  deployPath: string;
  description?: string | null;
  _count?: { files: number; targets: number };
}

interface ProjectDetail {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
  owner?: string | null;
  repoUrl?: string | null;
  tags?: string | null;
  environments: EnvironmentData[];
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  active: { label: "运行中", variant: "default" },
  maintenance: { label: "维护中", variant: "secondary" },
  archived: { label: "已归档", variant: "outline" },
};

const ENV_COLORS: Record<string, string> = {
  生产: "bg-red-500/10 text-red-600 dark:text-red-400",
  测试: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  开发: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [envDialogOpen, setEnvDialogOpen] = useState(false);
  const [editingEnv, setEditingEnv] = useState<EnvironmentData | null>(null);
  const [envForm, setEnvForm] = useState({ name: "", deployPath: "", description: "" });
  const [savingEnv, setSavingEnv] = useState(false);
  const [deletingEnv, setDeletingEnv] = useState<EnvironmentData | null>(null);

  async function load() {
    const res = await fetch(`/api/projects/${id}`);
    if (res.ok) setProject(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [id]);

  function openEnvDialog(env?: EnvironmentData) {
    if (env) {
      setEditingEnv(env);
      setEnvForm({ name: env.name, deployPath: env.deployPath, description: env.description ?? "" });
    } else {
      setEditingEnv(null);
      setEnvForm({ name: "", deployPath: "", description: "" });
    }
    setEnvDialogOpen(true);
  }

  async function handleSaveEnv() {
    if (!envForm.name || !envForm.deployPath) {
      toast.error("环境名称和部署目录为必填项");
      return;
    }
    setSavingEnv(true);
    try {
      const res = await fetch(editingEnv ? `/api/environments/${editingEnv.id}` : "/api/environments", {
        method: editingEnv ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...envForm, projectId: id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存失败");
      }
      toast.success(editingEnv ? "环境已更新" : "环境已创建");
      setEnvDialogOpen(false);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingEnv(false);
    }
  }

  async function handleDeleteEnv() {
    if (!deletingEnv) return;
    const res = await fetch(`/api/environments/${deletingEnv.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("环境已删除");
      setDeletingEnv(null);
      load();
    } else {
      toast.error("删除失败");
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">加载中...</p>;
  if (!project)
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">项目不存在</p>
        <Link href="/projects" className={buttonVariants({ variant: "outline" })}>
          ← 返回列表
        </Link>
      </div>
    );

  const st = STATUS_BADGE[project.status] ?? STATUS_BADGE.active;
  const tags = project.tags ? project.tags.split(",").filter(Boolean) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{project.description || "暂无描述"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {project.owner && <span>负责人: {project.owner}</span>}
            {project.repoUrl && (
              <a href={project.repoUrl} target="_blank" rel="noreferrer" className="underline">
                仓库
              </a>
            )}
            {tags.map((t) => (
              <Badge key={t} variant="secondary" className="text-xs">
                {t}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/projects" className={buttonVariants({ variant: "outline", size: "sm" })}>
            ← 返回
          </Link>
          <Button size="sm" onClick={() => openEnvDialog()}>
            + 添加环境
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">部署环境（{project.environments.length}）</h2>
        {project.environments.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              还没有环境，点击「+ 添加环境」创建（如 生产 / 测试）
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {project.environments.map((env) => (
              <Card key={env.id} className="transition-shadow hover:shadow-md">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <Link href={`/projects/${id}/env/${env.id}`} className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${ENV_COLORS[env.name] ?? "bg-muted text-muted-foreground"}`}
                        >
                          {env.name}
                        </span>
                      </div>
                      <div className="mt-2 font-mono text-sm">{env.deployPath}</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {env._count?.files ?? 0} 个共享文件 · {env._count?.targets ?? 0} 台服务器
                      </p>
                    </Link>
                    <div className="flex flex-col gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEnvDialog(env)}>
                        编辑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setDeletingEnv(env)}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 环境编辑对话框 */}
      <Dialog open={envDialogOpen} onOpenChange={setEnvDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingEnv ? "编辑环境" : "添加环境"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>环境名称 *</Label>
              <Input
                value={envForm.name}
                onChange={(e) => setEnvForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="生产 / 测试 / 开发"
              />
            </div>
            <div className="space-y-2">
              <Label>部署目录 *</Label>
              <Input
                value={envForm.deployPath}
                onChange={(e) => setEnvForm((f) => ({ ...f, deployPath: e.target.value }))}
                placeholder="/opt/aux-system"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">同步时文件将写入服务器的此目录</p>
            </div>
            <div className="space-y-2">
              <Label>描述</Label>
              <Textarea
                rows={2}
                value={envForm.description}
                onChange={(e) => setEnvForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEnvDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSaveEnv} disabled={savingEnv}>
              {savingEnv ? "保存中..." : "保存"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 环境删除确认 */}
      <Dialog open={!!deletingEnv} onOpenChange={(open) => !open && setDeletingEnv(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除环境「{deletingEnv?.name}」？</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            将同时删除该环境的共享文件、部署目标与专属文件配置，此操作不可撤销。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeletingEnv(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDeleteEnv}>
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
