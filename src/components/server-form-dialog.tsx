"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export interface ServerData {
  id: string;
  name: string;
  host: string;
  port: number;
  sshUser: string;
  sshAuthType: string;
  sshPassword?: string | null;
  sshPrivateKey?: string | null;
  os?: string | null;
  provider?: string | null;
  notes?: string | null;
  status?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server?: ServerData | null; // 传入则为编辑模式
  onSaved: () => void;
}

const EMPTY: Partial<ServerData> = {
  name: "",
  host: "",
  port: 22,
  sshUser: "root",
  sshAuthType: "password",
  sshPassword: "",
  sshPrivateKey: "",
  os: "",
  provider: "",
  notes: "",
};

export function ServerFormDialog({ open, onOpenChange, server, onSaved }: Props) {
  const isEdit = !!server;
  const [form, setForm] = useState<Partial<ServerData>>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(server ? { ...server, sshPassword: "", sshPrivateKey: "" } : EMPTY);
    }
  }, [open, server]);

  function set<K extends keyof ServerData>(key: K, value: ServerData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!form.name || !form.host) {
      toast.error("名称和主机地址为必填项");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/servers/${server!.id}` : "/api/servers", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存失败");
      }
      toast.success(isEdit ? "服务器已更新" : "服务器已创建");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑服务器" : "添加服务器"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>名称 *</Label>
              <Input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="生产服务器 B" />
            </div>
            <div className="space-y-2">
              <Label>供应商 / 区域</Label>
              <Input value={form.provider ?? ""} onChange={(e) => set("provider", e.target.value)} placeholder="AWS 东京" />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_100px] gap-4">
            <div className="space-y-2">
              <Label>主机地址 *</Label>
              <Input value={form.host ?? ""} onChange={(e) => set("host", e.target.value)} placeholder="1.2.3.4 或域名" />
            </div>
            <div className="space-y-2">
              <Label>端口</Label>
              <Input
                type="number"
                value={form.port ?? 22}
                onChange={(e) => set("port", Number(e.target.value))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>SSH 用户</Label>
              <Input value={form.sshUser ?? ""} onChange={(e) => set("sshUser", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>认证方式</Label>
              <Select value={form.sshAuthType ?? "password"} onValueChange={(v) => v && set("sshAuthType", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">密码</SelectItem>
                  <SelectItem value="privateKey">私钥</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {form.sshAuthType === "password" ? (
            <div className="space-y-2">
              <Label>SSH 密码 {isEdit && <span className="text-xs text-muted-foreground">(留空则不修改)</span>}</Label>
              <Input
                type="password"
                value={form.sshPassword ?? ""}
                onChange={(e) => set("sshPassword", e.target.value)}
                placeholder={isEdit && server?.sshPassword ? "已保存，留空不改" : "输入密码"}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label>SSH 私钥 {isEdit && <span className="text-xs text-muted-foreground">(留空则不修改)</span>}</Label>
              <Textarea
                rows={4}
                value={form.sshPrivateKey ?? ""}
                onChange={(e) => set("sshPrivateKey", e.target.value)}
                placeholder={isEdit && server?.sshPrivateKey ? "已保存，留空不改" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                className="font-mono text-xs"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>操作系统</Label>
            <Input value={form.os ?? ""} onChange={(e) => set("os", e.target.value)} placeholder="Ubuntu 22.04" />
          </div>
          <div className="space-y-2">
            <Label>备注</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
