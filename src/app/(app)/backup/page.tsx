"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

interface BackupConfigData {
  enabled: boolean;
  webdavUrl?: string | null;
  webdavPath?: string | null;
  username?: string | null;
  password?: string | null;
  retention: number;
  cronEvery: number;
  lastRunAt?: string | null;
}

interface LogData {
  id: string;
  trigger: string;
  status: string;
  fileName?: string | null;
  fileSize: number;
  remoteUrl?: string | null;
  durationMs: number;
  errorMessage?: string | null;
  createdAt: string;
}

interface RemoteFile {
  name: string;
  size: number;
  lastModified: string | null;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function BackupPage() {
  const [config, setConfig] = useState<BackupConfigData | null>(null);
  const [logs, setLogs] = useState<LogData[]>([]);
  const [remote, setRemote] = useState<RemoteFile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  async function load() {
    const [cfgRes, logRes] = await Promise.all([
      fetch("/api/backup/config"),
      fetch("/api/backup/logs"),
    ]);
    if (cfgRes.ok) setConfig(await cfgRes.json());
    if (logRes.ok) {
      const d = await logRes.json();
      setLogs(d.logs);
      setRemote(d.remote);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function set<K extends keyof BackupConfigData>(key: K, value: BackupConfigData[K]) {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  }

  async function handleSave() {
    if (config?.enabled && (!config.webdavUrl || !config.username || !config.password)) {
      toast.error("启用备份需要完整的 WebDAV 地址、用户名和密码");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/backup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setConfig(data);
      toast.success("配置已保存");
      if (data.testResult) {
        if (data.testResult.ok) toast.success("WebDAV 连接测试通过");
        else toast.warning("WebDAV 测试未通过", { description: data.testResult.message });
      }
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRun() {
    setRunning(true);
    toast.info("正在执行备份...");
    try {
      const res = await fetch("/api/backup/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "备份失败");
      toast.success(`备份成功`, {
        description: `${data.fileName}（${fmtSize(data.fileSize)}，${data.durationMs}ms）`,
      });
      load();
    } catch (e) {
      toast.error((e as Error).message);
      load();
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">加载中...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">备份</h1>
        <p className="text-sm text-muted-foreground">
          SQLite 快照（VACUUM INTO 一致性快照 + gzip）备份到 WebDAV，含全部项目/服务器凭据/环境配置
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              WebDAV 配置
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">启用</span>
                <Switch checked={config?.enabled ?? false} onCheckedChange={(v) => set("enabled", v)} />
              </div>
            </CardTitle>
            <CardDescription>支持坚果云、Nextcloud、Alist 等 WebDAV 服务</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>WebDAV 地址</Label>
              <Input
                value={config?.webdavUrl ?? ""}
                onChange={(e) => set("webdavUrl", e.target.value)}
                placeholder="https://dav.jianguoyun.com/dav/"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label>备份目录</Label>
              <Input
                value={config?.webdavPath ?? ""}
                onChange={(e) => set("webdavPath", e.target.value)}
                placeholder="/project-manager-backups"
                className="font-mono text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>用户名</Label>
                <Input value={config?.username ?? ""} onChange={(e) => set("username", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>密码 / 应用密码</Label>
                <Input
                  type="password"
                  value={config?.password ?? ""}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder={config?.password ? "已保存，输入可修改" : ""}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>定时备份</Label>
                <Select
                  value={String(config?.cronEvery ?? 24)}
                  onValueChange={(v) => v && set("cronEvery", Number(v))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="6">每 6 小时</SelectItem>
                    <SelectItem value="12">每 12 小时</SelectItem>
                    <SelectItem value="24">每天</SelectItem>
                    <SelectItem value="168">每周</SelectItem>
                    <SelectItem value="0">关闭（仅手动）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>保留数量</Label>
                <Input
                  type="number"
                  min={1}
                  value={config?.retention ?? 14}
                  onChange={(e) => set("retention", Number(e.target.value))}
                />
              </div>
            </div>
            {config?.lastRunAt && (
              <p className="text-xs text-muted-foreground">
                上次备份：{new Date(config.lastRunAt).toLocaleString("zh-CN")}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleRun} disabled={running || !config?.enabled}>
                {running ? "备份中..." : "立即备份"}
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "保存中..." : "保存配置"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>远端备份文件（{remote?.length ?? 0}）</CardTitle>
            <CardDescription>
              文件名含时间戳与内容 sha256，超出保留数量的旧备份自动清理
            </CardDescription>
          </CardHeader>
          <CardContent>
            {remote === null ? (
              <p className="text-sm text-muted-foreground">
                {config?.enabled ? "读取远端列表失败" : "备份未启用"}
              </p>
            ) : remote.length === 0 ? (
              <p className="text-sm text-muted-foreground">远端暂无备份文件，点击「立即备份」创建第一个</p>
            ) : (
              <div className="space-y-1.5">
                {remote.map((f) => (
                  <div key={f.name} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs">{f.name}</code>
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">{fmtSize(f.size)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>备份记录（{logs.length}）</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无备份记录</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>触发方式</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>文件</TableHead>
                  <TableHead>大小</TableHead>
                  <TableHead>耗时</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(log.createdAt).toLocaleString("zh-CN")}
                    </TableCell>
                    <TableCell className="text-sm">{log.trigger === "manual" ? "手动" : "定时"}</TableCell>
                    <TableCell>
                      {log.status === "success" ? (
                        <Badge>成功</Badge>
                      ) : (
                        <Badge variant="destructive">失败</Badge>
                      )}
                      {log.errorMessage && (
                        <div className="mt-1 max-w-md truncate text-xs text-destructive" title={log.errorMessage}>
                          {log.errorMessage}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-52 truncate font-mono text-xs">{log.fileName || "-"}</TableCell>
                    <TableCell className="text-sm">{log.fileSize ? fmtSize(log.fileSize) : "-"}</TableCell>
                    <TableCell className="text-sm">{log.durationMs}ms</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
