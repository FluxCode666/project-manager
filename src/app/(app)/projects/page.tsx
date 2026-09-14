"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  FolderKanban,
  GitBranch,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  ProjectFormDialog,
  type ProjectData,
} from "@/components/project-form-dialog";
import { toast } from "sonner";

const STATUS_BADGE: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "outline" | "destructive";
  }
> = {
  active: { label: "运行中", variant: "default" },
  maintenance: { label: "维护中", variant: "secondary" },
  archived: { label: "已归档", variant: "outline" },
};

type ProjectWithCount = ProjectData & { _count: { environments: number } };

function ProjectsContent() {
  const router = useRouter();
  const createRequested = useSearchParams().get("create") === "1";
  const [projects, setProjects] = useState<ProjectWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectData | null>(null);
  const [deleting, setDeleting] = useState<ProjectWithCount | null>(null);
  const [query, setQuery] = useState("");
  const visibleProjects = projects.filter((project) =>
    `${project.name} ${project.description ?? ""} ${project.owner ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  function onDialogChange(open: boolean) {
    setDialogOpen(open);
    if (!open && createRequested)
      router.replace("/projects", { scroll: false });
  }

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
    const res = await fetch(`/api/projects/${deleting.id}`, {
      method: "DELETE",
    });
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
      <div className="page-heading">
        <div>
          <h1>项目管理</h1>
          <p className="text-sm text-muted-foreground">
            管理团队所有项目及其部署环境
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" /> 创建项目
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">
          全部项目{" "}
          <span className="ml-2 rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            {projects.length}
          </span>
        </p>
        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="搜索项目"
            placeholder="搜索项目、描述或负责人…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {loading ? (
        <div
          role="status"
          aria-label="正在加载项目"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban strokeWidth={1.5} />}
            title="给下一个想法，一个起点"
            description="创建你的第一个项目，将团队、环境与部署配置组织在一起。"
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                创建项目
              </Button>
            }
          />
        </Card>
      ) : visibleProjects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Search strokeWidth={1.5} />}
            title="没有找到匹配的项目"
            description="换一个关键词，或清空搜索查看全部项目。"
            action={
              <Button variant="outline" onClick={() => setQuery("")}>
                清空搜索
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-flow-dense gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visibleProjects.map((p) => {
            const st = STATUS_BADGE[p.status] ?? STATUS_BADGE.active;
            return (
              <Card key={p.id} className="surface-link group">
                <CardContent>
                  <Link href={`/projects/${p.id}`} className="block min-w-0">
                    <div className="mb-5 flex items-center justify-between">
                      <span className="flex size-12 items-center justify-center rounded-xl bg-[#edf1e3] text-xl font-medium text-primary transition-transform duration-700 group-hover:scale-105">
                        {p.name.slice(0, 1).toUpperCase()}
                      </span>
                      <Badge variant={st.variant}>
                        <span
                          className="size-1 rounded-full bg-current"
                          aria-hidden="true"
                        />
                        {st.label}
                      </Badge>
                    </div>
                    <h3 className="flex items-center justify-between gap-3 font-semibold">
                      <span className="truncate">{p.name}</span>
                      <ArrowUpRight
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </h3>
                    <p className="mt-2 line-clamp-2 min-h-[2.75rem] text-xs leading-6 text-muted-foreground">
                      {p.description || "暂无描述"}
                    </p>
                  </Link>
                  <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound className="size-3.5" aria-hidden="true" />
                      {p.owner || "未指定负责人"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <GitBranch className="size-3.5" aria-hidden="true" />
                      {p._count.environments} 个环境
                    </span>
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                    <span className="text-[10px]">项目设置</span>
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
        open={dialogOpen || createRequested}
        onOpenChange={onDialogChange}
        project={editing}
        onSaved={() => load()}
      />

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              确认删除项目「{deleting?.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              将同时删除该项目的所有环境、部署文件配置与同步日志，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={handleDelete}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
      <ProjectsContent />
    </Suspense>
  );
}
