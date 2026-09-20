"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUpRight,
  ChevronRight,
  FolderKanban,
  Globe,
  HardDriveDownload,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  RefreshCw,
  Server,
  Sprout,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VersionDialog } from "@/components/version-dialog";
import { PasswordDialog } from "@/components/password-dialog";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/projects", label: "项目管理", icon: FolderKanban },
  { href: "/servers", label: "服务器", icon: Server },
  { href: "/nginx", label: "Nginx", icon: Globe },
  { href: "/logs", label: "同步日志", icon: RefreshCw },
  { href: "/backup", label: "数据备份", icon: HardDriveDownload },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);

  // 挂载时检查一次，之后每 30 分钟定时扫描新版本
  useEffect(() => {
    let cancelled = false;
    async function checkVersion() {
      try {
        const r = await fetch("/api/version");
        const d = await r.json();
        if (cancelled) return;
        setVersion(d.current);
        setUpdateAvailable(d.hasUpdate ? (d.latest?.tag ?? "new") : null);
      } catch {}
    }
    checkVersion();
    const timer = setInterval(checkVersion, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  async function handleLogout() {
    const response = await fetch("/api/logout", { method: "POST" });
    if (response.ok) {
      router.push("/login");
      router.refresh();
    }
  }

  const navigation = (
    <>
      <div className="px-5 pb-6 pt-6">
        <Link
          href="/"
          aria-label="项目管理首页"
          onClick={() => setMenuOpen(false)}
        >
          <Brand />
        </Link>
      </div>
      <div className="mx-4 mb-4 flex items-center gap-3 rounded-xl border bg-white/70 px-3 py-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#edf0e4] text-xs font-semibold text-primary">
          W
        </div>
        <div>
          <p className="text-xs font-medium">团队工作空间</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            让协作更有序
          </p>
        </div>
      </div>
      <nav aria-label="主导航" className="flex-1 space-y-1.5 px-3">
        <p className="mb-3 px-3 text-[11px] text-muted-foreground">工作台</p>
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex h-11 items-center gap-3 rounded-xl px-3 text-[13px] transition-colors",
                active
                  ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-muted hover:text-primary",
              )}
            >
              <item.icon
                className="size-[18px] transition-transform duration-300 group-hover:scale-110"
                strokeWidth={active ? 2 : 1.65}
                aria-hidden="true"
              />
              {item.label}
              {active && (
                <span
                  className="ml-auto size-1.5 rounded-full bg-primary"
                  aria-hidden="true"
                />
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mx-4 mb-4 mt-6 rounded-xl border bg-background p-3.5">
        <p className="flex items-center gap-2 text-xs font-medium">
          <Sprout
            className="size-4 shrink-0 text-primary"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          专注项目，安心交付。
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          定期备份，为每一次进展留底。
        </p>
        <Link
          href="/backup"
          onClick={() => setMenuOpen(false)}
          className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-primary"
        >
          管理备份 <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      <div className="border-t px-3 py-3">
        <Button
          variant="ghost"
          className="w-full justify-start text-xs text-muted-foreground"
          onClick={() => {
            setMenuOpen(false);
            setPasswordOpen(true);
          }}
        >
          <KeyRound className="size-4" aria-hidden="true" />
          修改密码
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start text-xs text-muted-foreground"
          onClick={handleLogout}
        >
          <LogOut className="size-4" aria-hidden="true" />
          退出登录
        </Button>
        <button
          onClick={() => {
            setMenuOpen(false);
            setVersionOpen(true);
          }}
          className="mt-1 flex w-full items-center justify-between rounded-lg px-4 py-2 text-[10px] text-muted-foreground transition-colors hover:bg-muted"
        >
          <span>Project Manager</span>
          <span className="flex items-center gap-1.5 font-mono">
            {updateAvailable && (
              <span
                className="size-1.5 animate-pulse rounded-full bg-red-500"
                title={`发现新版本 ${updateAvailable}，点击查看更新`}
              />
            )}
            {version ? `v${version.replace(/^v/, "")}` : "版本信息"}
          </span>
        </button>
      </div>
    </>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col overflow-y-auto border-r bg-sidebar md:flex">
        {navigation}
      </aside>
      <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b bg-sidebar/95 px-4 backdrop-blur-md md:hidden">
        <Link href="/" aria-label="项目管理首页">
          <Brand compact />
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label="打开导航菜单"
          onClick={() => setMenuOpen(true)}
        >
          <Menu aria-hidden="true" />
        </Button>
      </div>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent className="fixed top-0 left-0 h-dvh max-h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 gap-0 rounded-none bg-sidebar p-0">
          <DialogTitle className="sr-only">导航菜单</DialogTitle>
          <div className="flex min-h-full flex-col">{navigation}</div>
        </DialogContent>
      </Dialog>
      <VersionDialog open={versionOpen} onOpenChange={setVersionOpen} />
      <PasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  );
}

export function WorkspaceHeader({ date }: { date: string }) {
  const pathname = usePathname();
  const current = NAV_ITEMS.find(
    (item) => item.href !== "/" && pathname.startsWith(item.href),
  );
  return (
    <header className="flex h-[76px] items-center justify-between gap-3 border-b border-border/80 px-5 md:px-8 lg:px-10">
      <nav
        aria-label="面包屑导航"
        className="flex min-w-0 items-center gap-2 text-xs"
      >
        <Link
          href="/"
          className="text-muted-foreground transition-colors hover:text-primary"
        >
          工作空间
        </Link>
        <ChevronRight
          className="size-3 text-muted-foreground/60"
          aria-hidden="true"
        />
        {current && pathname !== current.href ? (
          <>
            <Link
              href={current.href}
              className="text-muted-foreground hover:text-primary"
            >
              {current.label}
            </Link>
            <ChevronRight
              className="size-3 text-muted-foreground/60"
              aria-hidden="true"
            />
            <span>详情</span>
          </>
        ) : (
          <span className="font-medium">{current?.label ?? "仪表盘"}</span>
        )}
      </nav>
      <div className="flex items-center gap-5">
        <span className="hidden text-xs text-muted-foreground sm:block">
          {date}
        </span>
        <span
          className="flex size-8 items-center justify-center rounded-full border-2 border-white bg-[#e4ebd9] text-xs font-medium text-primary"
          aria-label="团队成员"
        >
          PM
        </span>
      </div>
    </header>
  );
}
