"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "仪表盘", icon: "▦" },
  { href: "/projects", label: "项目", icon: "◈" },
  { href: "/servers", label: "服务器", icon: "▤" },
  { href: "/logs", label: "同步日志", icon: "≡" },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="text-lg">⬢</span>
        <span className="font-semibold">项目管理</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              isActive(item.href)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <span className="w-4 text-center">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="border-t p-3">
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={handleLogout}>
          <span className="w-4 text-center">⏻</span>
          退出登录
        </Button>
      </div>
    </aside>
  );
}
