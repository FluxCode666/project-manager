"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brand } from "@/components/brand";
import { CapabilityStrip } from "@/components/capability-strip";
import { WorkspaceMotion } from "@/components/workspace-motion";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setError(
          res.status === 401
            ? "访问密码不正确，请重新输入。"
            : "暂时无法登录，请稍后重试。",
        );
      }
    } catch {
      setError("网络连接失败，请重试。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative isolate min-h-dvh w-full max-w-full overflow-x-hidden bg-background">
      <nav
        aria-label="登录页导航"
        className="mx-auto flex h-24 max-w-[1400px] items-center justify-between gap-4 px-6 md:px-12"
      >
        <Brand />
        <span className="text-xs text-muted-foreground">
          团队的项目工作空间
        </span>
      </nav>
      <WorkspaceMotion>
        <div className="px-5 pt-6 pb-12 md:pt-10">
          <div className="text-center">
            <h1
              data-enter
              className="mx-auto w-full max-w-5xl text-[clamp(2rem,4vw,3.6rem)] leading-[1.4] font-medium tracking-tight"
            >
              少一点繁杂，
              <br className="sm:hidden" />
              <span
                className="landscape mx-3 hidden h-11 w-24 rounded-full align-middle sm:inline-block"
                aria-hidden="true"
              />
              多一点从容。
            </h1>
            <p
              data-enter
              className="mt-4 text-sm leading-7 text-muted-foreground"
            >
              把项目的每个细节，安放在恰好的位置。
            </p>
          </div>
          <section
            data-enter
            aria-labelledby="login-title"
            className="mx-auto mt-9 w-full max-w-[420px] rounded-[22px] border border-white bg-white/90 px-6 py-7 shadow-[0_16px_70px_-30px_#354d3330] sm:px-8"
          >
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h2
                  id="login-title"
                  className="text-xl font-medium tracking-tight"
                >
                  欢迎回来
                </h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  输入访问密码，继续你的工作。
                </p>
              </div>
              <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
                <KeyRound
                  className="size-5 text-primary"
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
              </span>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2.5">
                <Label htmlFor="password" className="text-xs">
                  访问密码
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入你的访问密码"
                    required
                    aria-invalid={!!error}
                    aria-describedby={error ? "login-error" : undefined}
                    className="h-12 bg-background pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    className="absolute top-1 right-1 flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
              {error && (
                <p
                  id="login-error"
                  role="alert"
                  className="rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive"
                >
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="h-12 w-full justify-between px-5"
                disabled={loading || !password}
              >
                <span>{loading ? "正在进入工作空间…" : "进入工作空间"}</span>
                {loading ? (
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <ArrowRight className="size-4" aria-hidden="true" />
                )}
              </Button>
            </form>
            <p className="mt-5 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
              <LockKeyhole className="size-3" aria-hidden="true" />
              仅限已获授权的团队成员访问
            </p>
          </section>
          <CapabilityStrip />
        </div>
      </WorkspaceMotion>
      <footer className="mx-auto flex max-w-[1400px] flex-wrap justify-between gap-3 border-t px-6 py-6 text-[10px] text-muted-foreground md:px-12">
        <span>Project Manager</span>
        <span>项目有序，协作从容。</span>
      </footer>
    </main>
  );
}
