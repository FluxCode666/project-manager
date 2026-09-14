"use client";

import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface VersionInfo {
  current: string;
  latest: {
    tag: string;
    name: string | null;
    publishedAt: string | null;
    htmlUrl: string;
    notes: string | null;
  } | null;
  hasUpdate: boolean;
  message?: string;
}

type Phase = "checking" | "idle" | "updating" | "restarting" | "done" | "error";

export function VersionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function check() {
    setPhase("checking");
    try {
      const res = await fetch("/api/version");
      const data = (await res.json()) as VersionInfo;
      setInfo(data);
      setPhase("idle");
    } catch (e) {
      setErrorMsg((e as Error).message);
      setPhase("error");
    }
  }

  useEffect(() => {
    if (open) {
      setInfo(null);
      setPhase("checking");
      setErrorMsg("");
      check();
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open]);

  async function handleUpdate() {
    setPhase("updating");
    try {
      const res = await fetch("/api/version/update", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "更新失败");

      toast.success(data.message || "更新中...");
      setPhase("restarting");

      // 服务退出重启期间轮询存活，恢复后刷新页面加载新版本
      pollRef.current = setInterval(async () => {
        try {
          const probe = await fetch("/api/version", { method: "HEAD" });
          if (probe.ok) {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase("done");
            toast.success("服务已恢复，刷新页面");
            setTimeout(() => {
              onOpenChange(false);
              window.location.reload();
            }, 1200);
          }
        } catch {
          // 服务仍在重启，继续等待
        }
      }, 2000);
    } catch (e) {
      setErrorMsg((e as Error).message);
      toast.error((e as Error).message);
      setPhase("error");
    }
  }

  const phaseText: Record<Phase, string> = {
    checking: "正在检查更新...",
    idle: "",
    updating: "正在下载并安装更新...",
    restarting: "服务重启中，等待恢复...",
    done: "更新完成！",
    error: "",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>版本与更新</DialogTitle>
          <DialogDescription>查看当前版本并检查 GitHub 发布的新版本</DialogDescription>
        </DialogHeader>

        {info && (
          <div className="min-w-0 space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">当前版本</span>
              <code className="font-mono font-medium">{info.current}</code>
            </div>
            {info.latest ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">最新发布</span>
                  <div className="flex items-center gap-2">
                    <code className="font-mono">{info.latest.tag}</code>
                    {info.hasUpdate ? (
                      <Badge>有新版本</Badge>
                    ) : (
                      <Badge variant="secondary">已是最新</Badge>
                    )}
                  </div>
                </div>
                {info.latest.publishedAt && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>发布时间</span>
                    <span>{new Date(info.latest.publishedAt).toLocaleString("zh-CN")}</span>
                  </div>
                )}
                {info.latest.notes && (
                  <>
                    <Separator />
                    <div>
                      <span className="text-muted-foreground">更新日志</span>
                      <div
                        className="mt-1 max-h-40 overflow-auto rounded bg-muted p-3 text-xs leading-relaxed [overflow-wrap:anywhere]
                          [&_h1]:my-3 [&_h1]:text-base [&_h1]:font-semibold
                          [&_h2]:my-3 [&_h2]:text-sm [&_h2]:font-semibold
                          [&_h3]:my-2 [&_h3]:font-semibold [&_h4]:my-2 [&_h4]:font-semibold
                          [&_h5]:my-2 [&_h5]:font-semibold [&_h6]:my-2 [&_h6]:font-semibold
                          [&_p]:my-2 [&_p]:whitespace-pre-line
                          [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5
                          [&_li]:my-1 [&_.contains-task-list]:list-none [&_.contains-task-list]:pl-0 [&_input]:mr-1.5
                          [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2
                          [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground
                          [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono
                          [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-background [&_pre]:p-2 [&_pre]:whitespace-pre
                          [&_pre_code]:bg-transparent [&_pre_code]:p-0
                          [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:px-2 [&_td]:py-1
                          [&_hr]:my-3 [&_img]:my-2 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded
                          [&>:first-child]:mt-0 [&>:last-child]:mb-0"
                      >
                        <Markdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ href, title, children }) => (
                              <a href={href} title={title} target="_blank" rel="noopener noreferrer">
                                {children}
                              </a>
                            ),
                            table: ({ children }) => (
                              <div className="my-2 overflow-x-auto">
                                <table className="w-full border-collapse">{children}</table>
                              </div>
                            ),
                          }}
                        >
                          {info.latest.notes}
                        </Markdown>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">{info.message || "暂无发布版本"}</p>
            )}
          </div>
        )}

        {phase !== "idle" && phase !== "error" && (
          <p className="text-sm text-muted-foreground">
            {phaseText[phase]}
            {phase === "checking" || phase === "updating" || phase === "restarting" ? "（此过程请勿关闭页面）" : ""}
          </p>
        )}
        {phase === "error" && <p className="text-sm text-destructive">{errorMsg}</p>}

        <div className="flex justify-between gap-2">
          {info?.latest && (
            <a
              href={info.latest.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            >
              查看 Release
            </a>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={check} disabled={phase === "checking" || phase === "updating" || phase === "restarting"}>
              重新检查
            </Button>
            <Button
              onClick={handleUpdate}
              disabled={phase === "checking" || phase === "updating" || phase === "restarting" || !info?.hasUpdate}
            >
              {phase === "done" ? "已完成" : "立即更新"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
