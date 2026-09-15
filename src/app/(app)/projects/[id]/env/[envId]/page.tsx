"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { FileEditDialog, type FileData } from "@/components/file-edit-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

interface EnvFileData extends FileData {
  environmentId: string;
}
interface TargetFileData extends FileData {
  deployTargetId: string;
}
interface SyncLogBrief {
  id: string;
  status: string;
  filesSynced: number;
  durationMs: number;
  createdAt: string;
}
interface TargetData {
  id: string;
  enabled: boolean;
  notes?: string | null;
  server: { id: string; name: string; host: string; status: string };
  files: TargetFileData[];
  syncLogs: SyncLogBrief[];
}
interface EnvironmentDetail {
  id: string;
  name: string;
  deployPath: string;
  description?: string | null;
  project: { id: string; name: string };
  files: EnvFileData[];
  targets: TargetData[];
}

const COMMON_COMMANDS = [
  { value: "none", label: "仅同步文件" },
  { value: "docker compose up -d", label: "docker compose up -d" },
  {
    value: "docker compose up -d --env-file .env",
    label: "docker compose up -d --env-file .env",
  },
  {
    value: "docker compose pull && docker compose up -d",
    label: "pull + up -d",
  },
];

const COMMAND_ITEMS: Record<string, string> = Object.fromEntries(
  COMMON_COMMANDS.map((c) => [c.value, c.label]),
);

export default function EnvironmentPage() {
  const { envId, id: projectId } = useParams<{ envId: string; id: string }>();
  const [env, setEnv] = useState<EnvironmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [servers, setServers] = useState<
    { id: string; name: string; host: string }[]
  >([]);

  // 共享文件编辑
  const [envFileDialog, setEnvFileDialog] = useState(false);
  const [editingEnvFile, setEditingEnvFile] = useState<EnvFileData | null>(
    null,
  );
  const [deleteEnvFile, setDeleteEnvFile] = useState<EnvFileData | null>(null);

  // 目标专属文件编辑
  const [targetFileDialog, setTargetFileDialog] = useState(false);
  const [editingTarget, setEditingTarget] = useState<TargetData | null>(null);
  const [editingTargetFile, setEditingTargetFile] =
    useState<TargetFileData | null>(null);

  // 绑定服务器
  const [bindDialog, setBindDialog] = useState(false);
  const [bindServerId, setBindServerId] = useState("");
  const [deletingTarget, setDeletingTarget] = useState<TargetData | null>(null);

  // 同步
  const [syncCommand, setSyncCommand] = useState("none");
  const [syncing, setSyncing] = useState<string | null>(null); // "all" 或 targetId
  const [pullTarget, setPullTarget] = useState<TargetData | null>(null);
  const [remoteFiles, setRemoteFiles] = useState<string[]>([]);
  const [selectedRemoteFiles, setSelectedRemoteFiles] = useState<string[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [importingRemote, setImportingRemote] = useState<"target" | "shared" | null>(null);
  const [promotingFile, setPromotingFile] = useState<{ target: TargetData; file: TargetFileData } | null>(null);

  async function load() {
    const [envRes, serversRes] = await Promise.all([
      fetch(`/api/environments/${envId}`),
      fetch("/api/servers"),
    ]);
    if (envRes.ok) setEnv(await envRes.json());
    if (serversRes.ok) setServers(await serversRes.json());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [envId]);

  // ---- 共享文件 ----
  async function saveEnvFile(filename: string, content: string) {
    if (editingEnvFile) {
      const res = await fetch(`/api/env-files/${editingEnvFile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok)
        throw new Error(
          ((await res.json()) as { error: string }).error || "保存失败",
        );
      toast.success("文件已保存");
    } else {
      const res = await fetch("/api/env-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentId: envId, filename, content }),
      });
      if (!res.ok)
        throw new Error(
          ((await res.json()) as { error: string }).error || "保存失败",
        );
      toast.success("文件已创建");
    }
    load();
  }

  async function handleDeleteEnvFile() {
    if (!deleteEnvFile) return;
    const res = await fetch(`/api/env-files/${deleteEnvFile.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("文件已删除");
      setDeleteEnvFile(null);
      load();
    }
  }

  // ---- 部署目标 ----
  async function handleBind() {
    if (!bindServerId) return;
    const res = await fetch("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environmentId: envId, serverId: bindServerId }),
    });
    if (res.ok) {
      toast.success("服务器已绑定");
      setBindDialog(false);
      setBindServerId("");
      load();
    } else {
      toast.error(
        ((await res.json()) as { error: string }).error || "绑定失败",
      );
    }
  }

  async function toggleTarget(t: TargetData, enabled: boolean) {
    await fetch(`/api/targets/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    load();
  }

  async function handleDeleteTarget() {
    if (!deletingTarget) return;
    const res = await fetch(`/api/targets/${deletingTarget.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("部署目标已移除");
      setDeletingTarget(null);
      load();
    }
  }

  // ---- 目标专属文件 ----
  async function saveTargetFile(filename: string, content: string) {
    if (!editingTarget) return;
    if (editingTargetFile) {
      const res = await fetch(`/api/target-files/${editingTargetFile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok)
        throw new Error(
          ((await res.json()) as { error: string }).error || "保存失败",
        );
      toast.success("文件已保存");
    } else {
      const res = await fetch("/api/target-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deployTargetId: editingTarget.id,
          filename,
          content,
        }),
      });
      if (!res.ok)
        throw new Error(
          ((await res.json()) as { error: string }).error || "保存失败",
        );
      toast.success("文件已创建");
    }
    load();
  }

  async function deleteTargetFile(file: TargetFileData) {
    const res = await fetch(`/api/target-files/${file.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("文件已删除");
      load();
    }
  }

  // ---- 同步 ----
  const command = syncCommand === "none" ? undefined : syncCommand;

  async function fetchRemoteContent(): Promise<void> {
    if (!editingTarget || !editingTargetFile) {
      toast.error("仅编辑已有文件时可拉取");
      return;
    }
    const res = await fetch(
      `/api/sync?deployTargetId=${editingTarget.id}&filename=${encodeURIComponent(editingTargetFile.filename)}`,
    );
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "拉取失败");
      return;
    }
    if (!data.exists) {
      toast.warning("服务器上不存在此文件");
      return;
    }
    // 直接回填：调用方通过重新打开对话框带新内容实现
    setEditingTargetFile({ ...editingTargetFile, content: data.content });
    toast.success("已拉取服务器内容，请注意核对后保存");
  }

  function reportResults(
    results: {
      serverName: string;
      status: string;
      filesSynced: number;
      errorMessage?: string;
    }[],
  ) {
    const ok = results.filter((r) => r.status === "success");
    const bad = results.filter((r) => r.status !== "success");
    if (ok.length) {
      toast.success(`同步成功 ${ok.length} 台`, {
        description: ok
          .map((r) => `${r.serverName}（${r.filesSynced} 文件）`)
          .join("、"),
      });
    }
    for (const b of bad) {
      toast.error(`${b.serverName} 同步失败`, {
        description: b.errorMessage?.slice(0, 200),
      });
    }
  }

  async function handleSyncAll() {
    setSyncing("all");
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentId: envId, command }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同步失败");
      if (!data.results?.length) toast.warning("没有启用中的部署目标");
      else reportResults(data.results);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(null);
    }
  }

  async function handleSyncOne(t: TargetData) {
    setSyncing(t.id);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deployTargetId: t.id, command }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同步失败");
      reportResults(data.results);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(null);
    }
  }

  async function openRemoteFiles(t: TargetData) {
    setPullTarget(t);
    setRemoteFiles([]);
    setSelectedRemoteFiles([]);
    setRemoteLoading(true);
    try {
      const res = await fetch(`/api/remote-files?deployTargetId=${t.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "读取失败");
      setRemoteFiles(data.files ?? []);
    } catch (e) {
      toast.error((e as Error).message);
      setPullTarget(null);
    } finally {
      setRemoteLoading(false);
    }
  }

  async function importRemoteFiles(mode: "target" | "shared") {
    if (!pullTarget || selectedRemoteFiles.length === 0) return;
    setImportingRemote(mode);
    try {
      const res = await fetch("/api/remote-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deployTargetId: pullTarget.id, filenames: selectedRemoteFiles, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");
      toast.success(`已导入 ${data.imported?.length ?? 0} 个文件${mode === "shared" ? "为环境共享文件" : "为服务器专属文件"}`);
      setPullTarget(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImportingRemote(null);
    }
  }

  async function promoteTargetFile(target: TargetData, file: TargetFileData) {
    try {
      const res = await fetch("/api/remote-files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deployTargetId: target.id, filenames: [file.filename], mode: "shared" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "升级失败");
      toast.success(`「${file.filename}」已升级为共享文件`);
      setPromotingFile(null);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loading)
    return <p className="text-sm text-muted-foreground">加载中...</p>;
  if (!env)
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">环境不存在</p>
        <Link
          href={`/projects/${projectId}`}
          className={buttonVariants({ variant: "outline" })}
        >
          ← 返回项目
        </Link>
      </div>
    );

  const boundServerIds = new Set(env.targets.map((t) => t.server.id));
  const availableServers = servers.filter((s) => !boundServerIds.has(s.id));

  return (
    <div className="space-y-6">
      <div className="page-heading items-start">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href={`/projects/${projectId}`} className="hover:underline">
              {env.project.name}
            </Link>
            <span>/</span>
            <span className="text-foreground">{env.name}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="break-words">{env.name} 环境</h1>
            <code className="max-w-full break-all rounded bg-muted px-2 py-1 font-mono text-xs">
              {env.deployPath}
            </code>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Select
            value={syncCommand}
            onValueChange={(v) => v && setSyncCommand(v)}
            items={COMMAND_ITEMS}
          >
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="同步后命令" />
            </SelectTrigger>
            <SelectContent>
              {COMMON_COMMANDS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleSyncAll}
            disabled={syncing !== null || env.targets.length === 0}
          >
            {syncing === "all" ? "同步中..." : "同步全部服务器"}
          </Button>
        </div>
      </div>

      {/* 共享文件 */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>共享文件（{env.files.length}）</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingEnvFile(null);
              setEnvFileDialog(true);
            }}
          >
            + 添加文件
          </Button>
        </CardHeader>
        <CardContent>
          {env.files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              还没有共享文件，添加 docker-compose.yml 等所有服务器共用的文件
            </p>
          ) : (
            <div className="space-y-2">
              {env.files.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div>
                    <code className="font-mono text-sm">{f.filename}</code>
                    <div className="text-xs text-muted-foreground">
                      {f.content.split("\n").length} 行 · 所有目标服务器共用
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingEnvFile(f);
                        setEnvFileDialog(true);
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDeleteEnvFile(f)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 部署目标 */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          部署目标（{env.targets.length} 台服务器）
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setBindDialog(true)}
          disabled={availableServers.length === 0}
        >
          + 绑定服务器
        </Button>
      </div>
      {env.targets.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            还没有绑定服务器，绑定后可为每台服务器维护专属 .env 文件
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {env.targets.map((t) => {
            const lastLog = t.syncLogs[0];
            return (
              <Card key={t.id}>
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/servers/${t.server.id}`}
                        className="font-semibold hover:underline"
                      >
                        {t.server.name}
                      </Link>
                      <Switch
                        checked={t.enabled}
                        onCheckedChange={(v) => toggleTarget(t, v)}
                      />
                    </div>
                    <code className="break-all text-xs text-muted-foreground">
                      {t.server.host} → {env.deployPath}
                    </code>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => openRemoteFiles(t)} disabled={!t.enabled}>
                      拉取文件
                    </Button>
                    <Button
                      size="sm"
                      disabled={syncing !== null || !t.enabled}
                      onClick={() => handleSyncOne(t)}
                    >
                      {syncing === t.id ? "同步中..." : "同步"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDeletingTarget(t)}
                    >
                      解绑
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {lastLog && (
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge
                        variant={
                          lastLog.status === "success"
                            ? "default"
                            : "destructive"
                        }
                      >
                        {lastLog.status === "success" ? "上次成功" : "上次失败"}
                      </Badge>
                      {new Date(lastLog.createdAt).toLocaleString("zh-CN")} ·{" "}
                      {lastLog.filesSynced} 文件 · {lastLog.durationMs}ms
                    </div>
                  )}
                  <div className="space-y-2">
                    {t.files.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        无专属文件（同步时仅写入共享文件）
                      </p>
                    ) : (
                      t.files.map((f) => (
                        <div
                          key={f.id}
                          className="flex items-center justify-between rounded-md border px-3 py-1.5"
                        >
                          <div>
                            <code className="font-mono text-sm">
                              {f.filename}
                            </code>
                            <div className="text-xs text-muted-foreground">
                              本机专属 · {f.content.split("\n").length} 行 ·
                              同步时覆盖同名共享文件
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPromotingFile({ target: t, file: f })}
                            >
                              升级共享
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingTarget(t);
                                setEditingTargetFile(f);
                                setTargetFileDialog(true);
                              }}
                            >
                              编辑
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => deleteTargetFile(f)}
                            >
                              删除
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setEditingTarget(t);
                        setEditingTargetFile(null);
                        setTargetFileDialog(true);
                      }}
                    >
                      + 添加专属文件（如 .env）
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 共享文件编辑对话框 */}
      <FileEditDialog
        key={`env-file-${envFileDialog ? "open" : "closed"}-${editingEnvFile?.id ?? "new"}-${editingEnvFile?.content ?? ""}`}
        open={envFileDialog}
        onOpenChange={setEnvFileDialog}
        title={
          editingEnvFile ? `编辑 ${editingEnvFile.filename}` : "添加共享文件"
        }
        file={editingEnvFile}
        filenameLocked={!!editingEnvFile}
        onSave={saveEnvFile}
      />

      <Dialog open={!!pullTarget} onOpenChange={(open) => !open && setPullTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>从服务器拉取文件</DialogTitle>
            <DialogDescription>
              {pullTarget?.server.name} · {env.deployPath}。选择文件后可导入为专属文件，或升级为当前环境的共享文件；同名共享文件会被服务器内容覆盖。
            </DialogDescription>
          </DialogHeader>
          {remoteLoading ? (
            <p className="text-sm text-muted-foreground">正在读取服务器目录…</p>
          ) : remoteFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">部署目录中没有普通文件，或目录不存在。</p>
          ) : (
            <>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                {remoteFiles.map((filename) => (
                  <label key={filename} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      checked={selectedRemoteFiles.includes(filename)}
                      onChange={(e) => setSelectedRemoteFiles((current) => e.target.checked ? [...current, filename] : current.filter((f) => f !== filename))}
                    />
                    <code className="font-mono">{filename}</code>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setSelectedRemoteFiles(selectedRemoteFiles.length === remoteFiles.length ? [] : remoteFiles)}>
                  {selectedRemoteFiles.length === remoteFiles.length ? "取消全选" : "全选"}
                </Button>
                <Button variant="outline" disabled={!selectedRemoteFiles.length || !!importingRemote} onClick={() => importRemoteFiles("target")}>
                  {importingRemote === "target" ? "导入中…" : "导入为专属文件"}
                </Button>
                <Button disabled={!selectedRemoteFiles.length || !!importingRemote} onClick={() => importRemoteFiles("shared")}>
                  {importingRemote === "shared" ? "升级中…" : "升级为共享文件"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 目标专属文件编辑对话框 */}
      <FileEditDialog
        key={`target-file-${targetFileDialog ? "open" : "closed"}-${editingTargetFile?.id ?? "new"}-${editingTargetFile?.content ?? ""}`}
        open={targetFileDialog}
        onOpenChange={setTargetFileDialog}
        title={
          editingTargetFile
            ? `编辑 ${editingTargetFile.filename}（${editingTarget?.server.name ?? ""}）`
            : `添加专属文件（${editingTarget?.server.name ?? ""}）`
        }
        file={editingTargetFile}
        filenameLocked={!!editingTargetFile}
        onSave={saveTargetFile}
        onFetchRemote={editingTargetFile ? fetchRemoteContent : undefined}
      />

      {/* 绑定服务器对话框 */}
      <AlertDialog open={bindDialog} onOpenChange={setBindDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>绑定服务器到「{env.name}」环境</AlertDialogTitle>
            <AlertDialogDescription>
              选择一台服务器作为部署目标，绑定后可为其维护专属 env 文件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Select
            value={bindServerId}
            onValueChange={(v) => v && setBindServerId(v)}
            items={Object.fromEntries(
              availableServers.map((s) => [s.id, `${s.name}（${s.host}）`]),
            )}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择服务器" />
            </SelectTrigger>
            <SelectContent>
              {availableServers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}（{s.host}）
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleBind} disabled={!bindServerId}>
              绑定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 共享文件删除确认 */}
      <AlertDialog
        open={!!deleteEnvFile}
        onOpenChange={(open) => !open && setDeleteEnvFile(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除共享文件「{deleteEnvFile?.filename}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              该文件将从本系统中删除；服务器上的已有文件不受影响，下次同步将不再写入此文件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={handleDeleteEnvFile}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 解绑确认 */}
      <AlertDialog
        open={!!deletingTarget}
        onOpenChange={(open) => !open && setDeletingTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              解绑服务器「{deletingTarget?.server.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              将删除该部署目标的专属文件配置与同步记录；服务器上的文件不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={handleDeleteTarget}
            >
              解绑
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!promotingFile} onOpenChange={(open) => !open && setPromotingFile(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>升级为环境共享文件？</AlertDialogTitle>
            <AlertDialogDescription>
              将「{promotingFile?.file.filename}」从 {promotingFile?.target.server.name} 的服务器内容导入为「{env.name}」环境共享文件，并移除该服务器的同名专属文件。系统中已有同名共享文件会被覆盖。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => promotingFile && promoteTargetFile(promotingFile.target, promotingFile.file)}>
              升级共享
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
