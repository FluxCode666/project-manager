"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { FilePlus2, Plus, RefreshCw, UploadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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

const FileCodeEditor = dynamic(() => import("@/components/file-code-editor"), {
  ssr: false,
  loading: () => (
    <div role="status" className="h-64 rounded-lg border bg-card p-3 text-xs text-muted-foreground">
      正在加载编辑器…
    </div>
  ),
});

interface SiteData {
  id: string;
  serverId: string;
  name: string;
  domains: string | null;
  content: string;
  enabled: boolean;
  notes: string | null;
  updatedAt: string;
}

interface RemoteSiteFile {
  filename: string;
  enabled: boolean;
}

const DEFAULT_SITE_TEMPLATE = `server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
`;

export function SitesTab({ serverId }: { serverId: string }) {
  const [sites, setSites] = useState<SiteData[]>([]);
  const [remote, setRemote] = useState<RemoteSiteFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SiteData | null>(null);
  const [deleting, setDeleting] = useState<SiteData | null>(null);
  const [pushingName, setPushingName] = useState<string | null>(null); // null=全部
  const [pushingAll, setPushingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/nginx/${serverId}/sites?remote=1`);
      if (res.ok) {
        const data = await res.json();
        setSites(data.sites ?? []);
        setRemote(data.remote ?? []);
      } else {
        toast.error("加载站点失败");
      }
    } catch {
      toast.error("加载站点失败");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    load();
  }, [load]);

  // 已知站点名集合（用于区分「远程未知文件」）
  const knownNames = new Set(sites.map((s) => s.name));
  const unknownRemote = remote.filter((r) => {
    const base = r.filename.replace(/\.conf(\.disabled)?$/, "");
    return !knownNames.has(base);
  });

  async function handleSave(site: SiteData, push: boolean) {
    const isEdit = !!editing;
    const url = isEdit
      ? `/api/nginx/${serverId}/sites/${encodeURIComponent(site.name)}${push ? "?push=1" : ""}`
      : `/api/nginx/${serverId}/sites${push ? "?push=1" : ""}`;
    const method = isEdit ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(site),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "保存失败");
    }
    if (push && data.push && !data.push.ok) {
      toast.error("已保存到数据库，但同步失败", { description: data.push.output });
    } else if (push) {
      toast.success("已保存并同步到服务器");
    } else {
      toast.success("已保存到数据库");
    }
    setDialogOpen(false);
    load();
  }

  async function handleToggle(site: SiteData) {
    setPushingName(site.name);
    try {
      const res = await fetch(
        `/api/nginx/${serverId}/sites/${encodeURIComponent(site.name)}?push=1`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !site.enabled }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "操作失败");
      if (data.push && !data.push.ok) {
        toast.error("数据库已更新，但同步失败", { description: data.push.output });
      } else {
        toast.success(site.enabled ? "已禁用站点" : "已启用站点");
      }
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPushingName(null);
    }
  }

  async function handlePush(site: SiteData) {
    setPushingName(site.name);
    try {
      const res = await fetch(
        `/api/nginx/${serverId}/sites/${encodeURIComponent(site.name)}?push=1`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "推送失败");
      if (data.push && data.push.ok) {
        toast.success("已同步到服务器");
      } else {
        toast.error("同步失败", { description: data.push?.output || data.error });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPushingName(null);
    }
  }

  async function handlePushAll() {
    setPushingAll(true);
    try {
      const res = await fetch(`/api/nginx/${serverId}/push`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        toast.success(`已同步 ${data.count ?? sites.length} 个站点`);
      } else {
        toast.error("同步失败", { description: data.output || data.error });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPushingAll(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      const res = await fetch(
        `/api/nginx/${serverId}/sites/${encodeURIComponent(deleting.name)}?remote=1`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "删除失败");
      if (data.push && !data.push.ok) {
        toast.warning("已从数据库删除，但服务器清理失败", { description: data.push.output });
      } else {
        toast.success("站点已删除");
      }
      setDeleting(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleImport(filename: string) {
    const base = filename.replace(/\.conf(\.disabled)?$/, "");
    try {
      const res = await fetch(
        `/api/nginx/${serverId}/sites/${encodeURIComponent(base)}?remote=1`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "读取失败");
      setEditing({
        id: "",
        serverId,
        name: base,
        domains: null,
        content: data.content ?? "",
        enabled: !filename.endsWith(".disabled"),
        notes: null,
        updatedAt: "",
      });
      setDialogOpen(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">站点配置（conf.d）</h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> 刷新
          </Button>
          <Button variant="outline" size="sm" onClick={handlePushAll} disabled={pushingAll || sites.length === 0}>
            <UploadCloud className={`size-4 ${pushingAll ? "animate-spin" : ""}`} aria-hidden="true" />
            {pushingAll ? "同步中..." : "推送全部"}
          </Button>
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="size-4" aria-hidden="true" /> 新建站点
          </Button>
        </div>
      </div>

      <Card>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : sites.length === 0 ? (
            <EmptyState
              icon={<FilePlus2 strokeWidth={1.5} />}
              title="还没有站点配置"
              description="新建站点配置后，可一键同步到服务器的 /etc/nginx/conf.d/ 目录并重载 nginx。"
              action={
                <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
                  <Plus className="size-4" aria-hidden="true" /> 新建站点
                </Button>
              }
            />
          ) : (
            <ul className="divide-y">
              {sites.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Switch
                      size="sm"
                      checked={s.enabled}
                      onCheckedChange={() => handleToggle(s)}
                      disabled={pushingName === s.name}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-medium">{s.name}.conf</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.domains || "未设置域名"} · {s.content.split("\n").length} 行
                      </p>
                    </div>
                  </div>
                  <Badge variant={s.enabled ? "default" : "outline"}>{s.enabled ? "启用" : "禁用"}</Badge>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pushingName === s.name}
                      onClick={() => handlePush(s)}
                    >
                      {pushingName === s.name ? "推送中..." : "推送"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setEditing(s); setDialogOpen(true); }}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDeleting(s)}
                    >
                      删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {!loading && unknownRemote.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">服务器上的其他配置文件（未纳入管理）</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {unknownRemote.map((r) => (
                <li key={r.filename} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <span className="truncate font-mono text-sm">{r.filename}</span>
                    <Badge variant={r.enabled ? "default" : "outline"} className="ml-2">
                      {r.enabled ? "启用" : "禁用"}
                    </Badge>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleImport(r.filename)}>
                    导入管理
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <SiteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        site={editing}
        onSave={handleSave}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除站点「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将从数据库删除该站点配置，并同时删除服务器上对应的 {deleting?.name}.conf（及 .disabled）文件，然后重载 nginx。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={handleDelete}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SiteDialog({
  open,
  onOpenChange,
  site,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  site: SiteData | null;
  onSave: (site: SiteData, push: boolean) => Promise<void>;
}) {
  const isEdit = !!site?.id;
  const [name, setName] = useState("");
  const [domains, setDomains] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [notes, setNotes] = useState("");
  const [content, setContent] = useState("");
  const [push, setPush] = useState(true);
  const [saving, setSaving] = useState(false);

  // 每次打开时根据 site 重置表单
  useEffect(() => {
    if (!open) return;
    if (site) {
      setName(site.name);
      setDomains(site.domains ?? "");
      setEnabled(site.enabled);
      setNotes(site.notes ?? "");
      setContent(site.content);
    } else {
      setName("");
      setDomains("");
      setEnabled(true);
      setNotes("");
      setContent(DEFAULT_SITE_TEMPLATE);
    }
    setPush(true);
  }, [open, site]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("站点名称不能为空");
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(name.trim()) || name.includes("..")) {
      toast.error("站点名称只能包含字母、数字、点、下划线、连字符");
      return;
    }
    setSaving(true);
    try {
      await onSave(
        {
          id: site?.id ?? "",
          serverId: site?.serverId ?? "",
          name: name.trim(),
          domains: domains.trim() || null,
          content,
          enabled,
          notes: notes.trim() || null,
          updatedAt: site?.updatedAt ?? "",
        },
        push,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? `编辑站点 ${name}` : "新建站点"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="site-name">站点名称</Label>
            <Input
              id="site-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isEdit}
              placeholder="example"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">对应 conf.d/{name}.conf</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-domains">域名（逗号分隔）</Label>
            <Input
              id="site-domains"
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="example.com, www.example.com"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="site-notes">备注</Label>
          <Input
            id="site-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="可选"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <Switch size="sm" checked={enabled} onCheckedChange={setEnabled} />
            <span>{enabled ? "启用" : "禁用"}</span>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch size="sm" checked={push} onCheckedChange={setPush} />
            保存后同步到服务器
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
          <FileCodeEditor filename={`${name || "site"}.conf`} value={content} onChange={setContent} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
