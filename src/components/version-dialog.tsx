"use client";

import { useEffect, useRef, useState } from "react";
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
          <div className="space-y-4 text-sm">
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
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                        {info.latest.notes.slice(0, 2000)}
                      </pre>
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
