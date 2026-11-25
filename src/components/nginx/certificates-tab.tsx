"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { fetchJson } from "@/lib/fetch-json";
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  KeyRound,
  ListChecks,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---- 与后端 src/lib/certificates.ts 返回结构对应的类型（不含任何密钥内容） ----

interface CertificateInfo {
  name: string;
  domains: string[];
  expiryDate: string | null;
  daysRemaining: number | null;
}

type CertListResult =
  | { state: "ok"; certs: CertificateInfo[]; version: string | null; via: "root" | "sudo" }
  | { state: "not_installed" }
  | { state: "unauthorized"; detail: string }
  | { state: "no_certs"; version: string | null; via: "root" | "sudo" };

interface GuideStep {
  id: string;
  title: string;
  description: string;
  commands?: string[];
  config?: string;
  configName?: string;
}

const DEFAULT_WEBROOT = "/var/www/html";

// ---- 浏览器端输入校验（复制内容前所有用户输入必须通过；与服务端同规则） ----

const CERT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DOMAIN_LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function checkDomains(domains: string[]): string | null {
  if (domains.length === 0) return "至少填写一个域名";
  if (domains.length > 10) return "一次最多 10 个域名";
  for (const d of domains) {
    if (d.length > 253 || d.includes("*")) return `域名无效：${d}（不支持通配符）`;
    const labels = d.split(".");
    if (labels.length < 2 || !labels.every((l) => DOMAIN_LABEL_RE.test(l))) {
      return `域名无效：${d}`;
    }
  }
  return null;
}

function checkCertName(name: string): string | null {
  if (!CERT_NAME_RE.test(name) || name.includes("..")) {
    return "证书名称无效：仅允许字母、数字、点、下划线、连字符，且不能以点开头";
  }
  return null;
}

function checkEmail(email: string): string | null {
  if (email.length > 254 || !EMAIL_RE.test(email)) return "邮箱格式无效";
  return null;
}

function checkWebroot(path: string): string | null {
  if (path === DEFAULT_WEBROOT) return null;
  if (!/^\/[A-Za-z0-9._\-/]{1,199}$/.test(path) || path.includes("..")) {
    return "webroot 路径无效：须为无空格的绝对路径";
  }
  return null;
}

// ---- 展示辅助 ----

function expiryText(days: number | null): string {
  if (days === null) return "未知";
  if (days < 0) return "已过期";
  if (days === 0) return "不足 1 天";
  return `剩 ${days} 天`;
}

function expiryVariant(days: number | null): "outline" | "secondary" | "destructive" {
  if (days === null) return "outline";
  if (days <= 14) return "destructive";
  if (days <= 30) return "secondary";
  return "outline";
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label}已复制`);
  } catch {
    toast.error("复制失败，请手动选择文本复制");
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button variant="outline" size="sm" onClick={() => copyText(text, label)}>
      <Copy className="size-4" aria-hidden="true" /> 复制{label}
    </Button>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed whitespace-pre">
      {text}
    </pre>
  );
}

function StateNotice({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="text-muted-foreground [&>svg]:size-10">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

// ---- 主标签页 ----

export function CertificatesTab({ serverId }: { serverId: string }) {
  const [result, setResult] = useState<CertListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [issueOpen, setIssueOpen] = useState(false);
  const [renewing, setRenewing] = useState<CertificateInfo | null>(null);
  const [renewingName, setRenewingName] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchJson<CertListResult>(`/api/certificates/${serverId}`)
      .then((data) => setResult(data))
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [serverId]);

  // 首次拉取：setState 发生在 fetch 回调里，不在 effect 同步体内
  useEffect(() => {
    let cancelled = false;
    fetchJson<CertListResult>(`/api/certificates/${serverId}`)
      .then((data) => {
        if (!cancelled) {
          setResult(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [serverId]);

  async function handleRenew(cert: CertificateInfo) {
    if (renewingName !== null) return; // 防重复执行
    setRenewingName(cert.name);
    try {
      const res = await fetch(`/api/certificates/${serverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "renew", certName: cert.name }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; output?: string };
      if (!res.ok) {
        toast.error(data.error ?? "续期失败", { description: data.output?.slice(0, 300), duration: 8000 });
        return;
      }
      toast.success("续期完成", {
        description: data.output?.split("\n").filter(Boolean).slice(-3).join(" / "),
      });
      setRenewing(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRenewingName(null);
    }
  }

  const certs = result?.state === "ok" ? result.certs : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">证书（Certbot · Let&apos;s Encrypt）</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> 刷新
          </Button>
          <Button
            size="sm"
            onClick={() => setIssueOpen(true)}
            disabled={result?.state === "not_installed" || result?.state === "unauthorized"}
          >
            <ShieldCheck className="size-4" aria-hidden="true" /> 申请证书
          </Button>
        </div>
      </div>

      <GuideCard serverId={serverId} />

      <Card>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : !result ? null : result.state === "not_installed" ? (
            <StateNotice
              icon={<CircleAlert strokeWidth={1.5} />}
              title="宿主机未检测到 Certbot"
              description="请先在宿主机安装 certbot（见上方指引第 3 步），安装后刷新本页。"
            />
          ) : result.state === "unauthorized" ? (
            <StateNotice
              icon={<KeyRound strokeWidth={1.5} />}
              title="当前 SSH 用户无权执行 Certbot（已确认 certbot 存在，不是未安装）"
              description="请使用已有执行权限的 SSH 账号，或请管理员在宿主机按指引手动操作。不要为了启用本功能放开 sudo 权限。"
            />
          ) : result.state === "no_certs" ? (
            <StateNotice
              icon={<BadgeCheck strokeWidth={1.5} />}
              title={`Certbot 已安装${result.version ? `（${result.version}，${result.via === "root" ? "root 执行" : "免密 sudo 执行"}）` : ""}，尚无证书`}
              description="按上方步骤完成 DNS、80 端口与 ACME 配置后，点击「申请证书」签发第一张证书。"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>证书名称</TableHead>
                  <TableHead>域名</TableHead>
                  <TableHead>有效期至</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {certs.map((c) => (
                  <TableRow key={c.name}>
                    <TableCell className="font-mono text-sm">{c.name}</TableCell>
                    <TableCell className="max-w-64">
                      <span className="line-clamp-2 text-sm">{c.domains.join("、") || "—"}</span>
                    </TableCell>
                    <TableCell className="text-sm">{c.expiryDate ?? "未知"}</TableCell>
                    <TableCell>
                      <Badge variant={expiryVariant(c.daysRemaining)}>{expiryText(c.daysRemaining)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={renewingName !== null}
                        onClick={() => setRenewing(c)}
                      >
                        {renewingName === c.name ? "续期中..." : "续期"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <IssueDialog open={issueOpen} onOpenChange={setIssueOpen} serverId={serverId} onIssued={load} />

      <AlertDialog
        open={renewing !== null}
        onOpenChange={(o) => {
          // 续期执行期间禁止关闭，避免重复执行
          if (renewingName !== null) return;
          if (!o) setRenewing(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>续期证书「{renewing?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将在宿主机执行 certbot renew --cert-name {renewing?.name}
              。certbot 仅在临近到期时实际续期（不强制）；nginx 直接引用 certbot live 路径的证书，
              续期成功后由 deploy hook 负责校验并重载。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={renewingName !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={renewingName !== null}
              onClick={(e) => {
                e.preventDefault();
                if (renewing) void handleRenew(renewing);
              }}
            >
              {renewingName ? "续期中..." : "确认续期"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---- 分步指引（模板由服务端 /api/certificates/[serverId]?guide=1 生成，前端只校验输入并渲染） ----

export function GuideCard({ serverId }: { serverId: string }) {
  const [open, setOpen] = useState(false);
  const [certName, setCertName] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [email, setEmail] = useState("");
  const [steps, setSteps] = useState<GuideStep[] | null>(null);
  const [guideLoading, setGuideLoading] = useState(false);

  const domains = domainInput
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const effectiveName = certName.trim() || domains[0] || "";

  async function handleGenerate() {
    const domainErr = checkDomains(domains);
    if (domainErr) {
      toast.error(domainErr);
      return;
    }
    const nameErr = checkCertName(effectiveName);
    if (nameErr) {
      toast.error(nameErr);
      return;
    }
    if (email.trim()) {
      const emailErr = checkEmail(email.trim());
      if (emailErr) {
        toast.error(emailErr);
        return;
      }
    }
    setGuideLoading(true);
    try {
      const query = new URLSearchParams({
        guide: "1",
        domains: domains.join(","),
        certName: effectiveName,
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      const data = await fetchJson<{ steps: GuideStep[] }>(`/api/certificates/${serverId}?${query}`);
      setSteps(data.steps);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGuideLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ListChecks className="size-4" aria-hidden="true" /> 签发与续期指引（手动执行，不会自动修改服务器）
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
          {open ? "收起" : "展开"}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="guide-domains">域名（空格/逗号分隔）</Label>
              <Input
                id="guide-domains"
                placeholder="example.com www.example.com"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="guide-cert-name">证书名称</Label>
              <Input
                id="guide-cert-name"
                placeholder="留空取第一个域名"
                value={certName}
                onChange={(e) => setCertName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="guide-email">通知邮箱</Label>
              <Input
                id="guide-email"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={handleGenerate} disabled={guideLoading}>
              {guideLoading ? "生成中..." : "生成指引与可复制配置"}
            </Button>
          </div>
          {steps && (
            <ol className="space-y-3">
              {steps.map((s) => (
                <li key={s.id} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>
                  {s.commands?.map((c, i) => (
                    <div key={i} className="mt-2 space-y-1">
                      <CodeBlock text={c} />
                      <div className="flex justify-end">
                        <CopyButton text={c} label="命令" />
                      </div>
                    </div>
                  ))}
                  {s.config && (
                    <div className="mt-2 space-y-1">
                      <CodeBlock text={s.config} />
                      <div className="flex justify-end">
                        <CopyButton text={s.config} label={s.configName ?? "配置"} />
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ---- 申请证书对话框（需用户显式确认后才提交；提交期间禁止关闭/重复提交） ----

function IssueDialog({
  open,
  onOpenChange,
  serverId,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  onIssued: () => void;
}) {
  const [domainInput, setDomainInput] = useState("");
  const [certName, setCertName] = useState("");
  const [email, setEmail] = useState("");
  const [webroot, setWebroot] = useState(DEFAULT_WEBROOT);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastOutput, setLastOutput] = useState<string | null>(null);

  function reset() {
    setDomainInput("");
    setCertName("");
    setEmail("");
    setWebroot(DEFAULT_WEBROOT);
    setConfirmed(false);
    setSubmitting(false);
    setLastOutput(null);
  }

  function tryClose(next: boolean) {
    // 提交期间禁止关闭对话框，避免重复提交
    if (submitting) return;
    onOpenChange(next);
    if (!next) reset();
  }

  async function handleSubmit() {
    if (submitting) return; // 防重复执行
    const domains = [...new Set(domainInput.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean))];
    const domainErr = checkDomains(domains);
    if (domainErr) {
      toast.error(domainErr);
      return;
    }
    const effectiveName = certName.trim() || domains[0];
    const nameErr = checkCertName(effectiveName);
    if (nameErr) {
      toast.error(nameErr);
      return;
    }
    const emailErr = checkEmail(email.trim());
    if (emailErr) {
      toast.error(emailErr);
      return;
    }
    const webrootErr = checkWebroot(webroot.trim() || DEFAULT_WEBROOT);
    if (webrootErr) {
      toast.error(webrootErr);
      return;
    }
    if (!confirmed) {
      toast.error("请先勾选确认：申请真实证书才会提交");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/certificates/${serverId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "issue",
          domains,
          email: email.trim(),
          certName: effectiveName,
          webroot: webroot.trim() || DEFAULT_WEBROOT,
          confirm: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; output?: string };
      setLastOutput(data.output ?? null);
      if (!res.ok) {
        toast.error(data.error ?? "申请失败", { duration: 8000 });
        return;
      }
      toast.success("证书申请成功，请按指引完成 HTTPS 配置");
      onIssued();
      tryClose(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={tryClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>申请 Let&apos;s Encrypt 证书（HTTP-01 · webroot）</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="issue-domains">域名（空格/逗号分隔，不支持通配符）</Label>
            <Input
              id="issue-domains"
              placeholder="example.com www.example.com"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="issue-cert-name">证书名称（留空取第一个域名）</Label>
            <Input
              id="issue-cert-name"
              placeholder="example.com"
              value={certName}
              onChange={(e) => setCertName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="issue-email">通知邮箱</Label>
            <Input
              id="issue-email"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="issue-webroot">webroot 路径</Label>
            <Input id="issue-webroot" value={webroot} onChange={(e) => setWebroot(e.target.value)} />
            <p className="text-xs text-muted-foreground">默认 /var/www/html，与部署示例的 ACME 目录一致。</p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              我确认 DNS 已解析到本机、公网 80 可达、ACME challenge 配置已生效，
              现在向 Let&apos;s Encrypt 生产端点申请真实证书（不勾选不会提交）。
            </span>
          </label>
          {lastOutput && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">最近一次输出（便于定位失败原因）</p>
              <CodeBlock text={lastOutput} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => tryClose(false)} disabled={submitting}>
            关闭
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !confirmed}>
            {submitting ? "申请中..." : "确认申请"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
