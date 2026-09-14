import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  FolderKanban,
  GitBranch,
  Layers3,
  Plus,
  RefreshCw,
  Server,
  X,
} from "lucide-react";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { WorkspaceMotion } from "@/components/workspace-motion";
import { WorkflowGuide } from "@/components/workflow-guide";

export const dynamic = "force-dynamic";

const STATUS_MAP: Record<
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
        deployTarget: {
          include: {
            server: true,
            environment: { include: { project: true } },
          },
        },
      },
    }),
  ]);
  const activeCount = projects.filter(
    (project) => project.status === "active",
  ).length;
  const metrics = [
    {
      label: "项目总数",
      value: projects.length,
      detail: `${activeCount} 个项目运行中`,
      icon: FolderKanban,
      href: "/projects",
      color: "bg-[#edf1e3] text-[#527138]",
    },
    {
      label: "服务器资产",
      value: serverCount,
      detail: "集中管理基础设施",
      icon: Server,
      href: "/servers",
      color: "bg-[#e8eeeb] text-[#4b7665]",
    },
    {
      label: "部署环境",
      value: envCount,
      detail: "让每份配置各就其位",
      icon: GitBranch,
      href: "/projects",
      color: "bg-[#f4efe0] text-[#96834a]",
    },
  ];

  return (
    <WorkspaceMotion>
      <section
        className="dashboard-hero group relative isolate overflow-hidden rounded-[20px] px-5 py-8 text-center text-white md:py-9"
        aria-labelledby="dashboard-title"
      >
        <div
          className="landscape absolute inset-0 -z-20 transition-transform duration-700 ease-out group-hover:scale-105"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,#173d3280,transparent)]"
          aria-hidden="true"
        />
        <p data-enter className="mb-3 text-xs tracking-[0.12em] text-[#dce6cf]">
          欢迎回到你的工作空间
        </p>
        <h1
          data-enter
          id="dashboard-title"
          className="mx-auto w-full max-w-5xl text-[clamp(1.75rem,2.8vw,2.6rem)] leading-[1.35] font-medium tracking-tight"
        >
          让每个项目，井然有序。
        </h1>
        <p
          data-enter
          className="mx-auto mt-3 max-w-xl text-xs leading-6 text-white/75 sm:text-sm"
        >
          项目、服务器与部署配置，在这里从容掌握。
        </p>
        <div data-enter className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/projects?create=1"
            className={buttonVariants({
              className:
                "border-white bg-[#e6edcf] text-[#234732] hover:bg-white shadow-none",
            })}
          >
            <Plus className="size-4" aria-hidden="true" />
            创建项目
          </Link>
          <Link
            href="/servers"
            className={buttonVariants({
              variant: "outline",
              className:
                "border-white/35 bg-white/10 text-white hover:bg-white/20 hover:text-white",
            })}
          >
            查看服务器 <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section
        aria-label="工作空间数据总览"
        className="mt-6 grid grid-flow-dense gap-4 sm:grid-cols-3"
      >
        {metrics.map((metric) => (
          <Link
            data-enter
            href={metric.href}
            key={metric.label}
            className="surface-link group overflow-hidden rounded-2xl border bg-card px-5 py-5"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {metric.label}
              </span>
              <span
                className={`flex size-9 items-center justify-center rounded-xl ${metric.color}`}
              >
                <metric.icon
                  className="size-[18px] transition-transform duration-700 group-hover:scale-110"
                  strokeWidth={1.6}
                  aria-hidden="true"
                />
              </span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-[38px] leading-tight font-medium tracking-tight tabular-nums">
                {String(metric.value).padStart(2, "0")}
              </span>
              <span className="text-xs text-muted-foreground">个</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                {metric.detail}
              </span>
              <ArrowUpRight
                className="size-3.5 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                aria-hidden="true"
              />
            </div>
          </Link>
        ))}
      </section>

      <div className="mt-8 mb-4 flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
        <h2 className="text-sm font-medium">工作空间动态</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">
          最近更新
        </span>
      </div>
      <div className="grid grid-flow-dense gap-5 lg:grid-cols-12">
        <section
          className="min-w-0 overflow-hidden rounded-2xl border bg-card lg:col-span-7"
          aria-labelledby="projects-title"
        >
          <div className="flex items-center justify-between border-b px-5 py-5">
            <div className="flex items-center gap-2.5">
              <h3 id="projects-title" className="text-sm font-semibold">
                我的项目
              </h3>
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {projects.length}
              </span>
            </div>
            <Link
              href="/projects"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
            >
              查看全部 <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          {projects.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center px-5 py-8 text-center">
              <FolderKanban
                className="mb-4 size-8 text-primary/40"
                strokeWidth={1.3}
                aria-hidden="true"
              />
              <p className="text-sm font-medium">好项目，从这里开始</p>
              <p className="mt-2 text-xs text-muted-foreground">
                创建第一个项目，组织你的环境与配置。
              </p>
              <Link
                href="/projects?create=1"
                className="mt-5 text-xs font-medium text-primary"
              >
                创建项目{" "}
                <ArrowRight
                  className="ml-1 inline size-3.5"
                  aria-hidden="true"
                />
              </Link>
            </div>
          ) : (
            <div className="p-2">
              {projects.slice(0, 6).map((project, index) => {
                const status = STATUS_MAP[project.status] ?? STATUS_MAP.active;
                return (
                  <Link
                    key={project.id}
                    href={`/projects/${project.id}`}
                    className="group flex min-w-0 items-center gap-3 rounded-xl px-3 py-4 transition-colors hover:bg-muted/70 sm:gap-4"
                  >
                    <span
                      className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-medium transition-transform duration-700 group-hover:scale-105 ${index % 2 ? "bg-[#e7edeb] text-[#58796d]" : "bg-[#edf0e2] text-[#6e804b]"}`}
                    >
                      {project.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {project.name}
                      </p>
                      <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                        {project.owner || "未指定负责人"}
                        <span className="mx-2 text-border">/</span>
                        {project._count.environments} 个环境
                      </p>
                    </div>
                    <Badge variant={status.variant}>
                      <span
                        className="mr-0.5 size-1 rounded-full bg-current"
                        aria-hidden="true"
                      />
                      {status.label}
                    </Badge>
                    <ArrowUpRight
                      className="hidden size-4 text-muted-foreground/50 transition-colors group-hover:text-primary sm:block"
                      aria-hidden="true"
                    />
                  </Link>
                );
              })}
              <Link
                href="/projects?create=1"
                className="mx-3 mt-1 mb-3 flex items-center justify-center gap-2 rounded-xl border border-dashed py-3.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted hover:text-primary"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                创建一个新项目
              </Link>
            </div>
          )}
        </section>
        <section
          className="min-w-0 overflow-hidden rounded-2xl border bg-card lg:col-span-5"
          aria-labelledby="sync-title"
        >
          <div className="flex items-center justify-between border-b px-5 py-5">
            <h3 id="sync-title" className="text-sm font-semibold">
              最近同步
            </h3>
            <Link
              href="/logs"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
            >
              全部记录 <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          {recentLogs.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center px-5 py-8 text-center">
              <RefreshCw
                className="mb-4 size-8 text-primary/40"
                strokeWidth={1.3}
                aria-hidden="true"
              />
              <p className="text-sm font-medium">等待第一次同步</p>
              <p className="mt-2 text-xs text-muted-foreground">
                部署文件后，可以在这里查看执行结果。
              </p>
            </div>
          ) : (
            <div className="px-5 py-2">
              {recentLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex gap-3 border-b py-4 last:border-0"
                >
                  <span
                    className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${log.status === "success" ? "bg-primary/10 text-primary" : "bg-[#fbefeb] text-[#b56755]"}`}
                  >
                    {log.status === "success" ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      <X className="size-3.5" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium">
                        {log.deployTarget.environment.project.name}
                      </p>
                      <span
                        className={`shrink-0 text-[10px] ${log.status === "success" ? "text-primary" : "text-[#a85646]"}`}
                      >
                        {log.status === "success" ? "同步成功" : "同步失败"}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                      {log.deployTarget.environment.name}{" "}
                      <ArrowRight
                        className="mx-1 inline size-2.5"
                        aria-hidden="true"
                      />{" "}
                      {log.deployTarget.server.name}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground/85">
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="size-3" aria-hidden="true" />
                        {new Intl.DateTimeFormat("zh-CN", {
                          timeZone: "Asia/Shanghai",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        }).format(new Date(log.createdAt))}
                      </span>
                      <span>
                        {log.filesSynced} 个文件 · {log.durationMs} ms
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <ArrowDownLeft className="size-3.5" aria-hidden="true" />
        <span>从项目进入环境，管理配置与部署目标。</span>
        <Layers3
          className="ml-auto hidden size-3.5 text-primary/50 sm:block"
          aria-hidden="true"
        />
      </div>
      <WorkflowGuide />
    </WorkspaceMotion>
  );
}
