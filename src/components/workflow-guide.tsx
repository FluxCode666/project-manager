import Link from "next/link";
import {
  ArrowRight,
  CloudUpload,
  FolderKanban,
  GitBranch,
  ShieldCheck,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

const steps = [
  {
    title: "给项目一个清晰的起点",
    description: "归集项目档案、负责人和代码仓库，让团队随时找到所需的信息。",
    action: "管理项目",
    href: "/projects",
    icon: FolderKanban,
    color: "bg-[#f5f1e7]",
    detail: "项目档案 / 团队协作",
  },
  {
    title: "每个环境，各就其位",
    description: "组织开发、测试与生产环境，统一管理共享文件和服务器专属配置。",
    action: "查看服务器",
    href: "/servers",
    icon: GitBranch,
    color: "bg-[#f8f6f1]",
    detail: "环境配置 / 服务器资产",
  },
  {
    title: "让每次交付都有迹可循",
    description: "同步部署文件，查看执行结果。用完整的操作记录，让交付更从容。",
    action: "查看同步记录",
    href: "/logs",
    icon: CloudUpload,
    color: "bg-[#efeeea]",
    detail: "配置同步 / 执行记录",
  },
];

export function WorkflowGuide() {
  return (
    <section
      aria-labelledby="workflow-title"
      className="mt-14 border-t pt-14 pb-10 md:mt-20 md:pt-20"
    >
      <div className="grid gap-8 xl:grid-cols-[0.85fr_1.15fr] xl:gap-16">
        <div className="self-start" data-workflow-title>
          <h2
            id="workflow-title"
            className="text-3xl leading-[1.5] font-medium tracking-tight md:text-4xl"
          >
            从想法，
            <span
              aria-hidden="true"
              className="landscape mx-2 inline-block h-9 w-20 rounded-full align-middle"
            />
            <br />
            到稳定交付。
          </h2>
          <p className="mt-5 max-w-xs text-sm leading-7 text-muted-foreground">
            把项目、环境和服务器连接起来。
            <br />
            在一个工作空间，推进每一步。
          </p>
          <Link
            href="/projects"
            className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-primary"
          >
            开始管理项目 <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="relative space-y-5 pb-3">
          {steps.map((step) => (
            <article
              key={step.href}
              data-stack-card
              className={`relative rounded-2xl border border-white/70 p-7 shadow-[0_4px_16px_-12px_#233b3240] ${step.color}`}
            >
              <div className="mb-5 flex items-center justify-between">
                <step.icon
                  className="size-6 text-primary"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span className="text-[11px] text-muted-foreground">
                  {step.detail}
                </span>
              </div>
              <h3 className="text-lg font-medium">{step.title}</h3>
              <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                {step.description}
              </p>
              <Link
                href={step.href}
                className="group mt-5 inline-flex items-center gap-2 text-xs font-medium text-primary"
              >
                {step.action}
                <ArrowRight
                  className="size-3.5 transition-transform group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </Link>
            </article>
          ))}
        </div>
      </div>
      <div className="mt-14 flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-primary px-7 py-8 text-white md:mt-20 md:px-10">
        <div className="flex items-center gap-5">
          <ShieldCheck
            className="hidden size-9 text-[#cdddb1] sm:block"
            strokeWidth={1.3}
            aria-hidden="true"
          />
          <div>
            <h3 className="text-xl font-medium">进展值得被妥善保存。</h3>
            <p className="mt-2 text-xs leading-6 text-white/70">
              配置自动备份，为项目与团队多一份保障。
            </p>
          </div>
        </div>
        <Link
          href="/backup"
          className={buttonVariants({
            variant: "secondary",
            className: "bg-[#e5edcd] text-[#264933] hover:bg-white",
          })}
        >
          前往数据备份 <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
