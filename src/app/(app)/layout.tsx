import { Sidebar, WorkspaceHeader } from "@/components/sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const date = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <a
        href="#workspace-main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-3 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        跳转到主要内容
      </a>
      <Sidebar />
      <main
        id="workspace-main"
        className="flex w-full min-w-0 max-w-full flex-1 flex-col overflow-x-hidden"
      >
        <WorkspaceHeader date={date} />
        <div className="workspace-content mx-auto w-full max-w-[1440px] flex-1 px-5 py-7 md:px-8 lg:px-10 lg:py-8">
          {children}
        </div>
        <footer className="mx-5 mt-auto flex flex-wrap justify-between gap-2 border-t py-6 text-[11px] text-muted-foreground md:mx-8 lg:mx-10">
          <span>Project Manager</span>
          <span>项目有序，协作从容。</span>
        </footer>
      </main>
    </div>
  );
}
