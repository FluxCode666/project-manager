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
import { toast } from "sonner";

export interface ProjectData {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  status: string;
  owner?: string | null;
  repoUrl?: string | null;
  tags?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: ProjectData | null;
  onSaved: (project: ProjectData) => void;
}

const EMPTY: Partial<ProjectData> = {
  name: "",
  description: "",
  status: "active",
  owner: "",
  repoUrl: "",
  tags: "",
};

export function ProjectFormDialog({ open, onOpenChange, project, onSaved }: Props) {
  const isEdit = !!project;
  const [form, setForm] = useState<Partial<ProjectData>>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(project ? { ...project } : EMPTY);
  }, [open, project]);

  function set<K extends keyof ProjectData>(key: K, value: ProjectData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    if (!form.name) {
      toast.error("项目名称为必填项");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(isEdit ? `/api/projects/${project!.id}` : "/api/projects", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存失败");
      }
      const saved = await res.json();
      toast.success(isEdit ? "项目已更新" : "项目已创建");
      onOpenChange(false);
      onSaved(saved);
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
          <DialogTitle>{isEdit ? "编辑项目" : "创建项目"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2">
            <Label>项目名称 *</Label>
            <Input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="aux-system" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>状态</Label>
              <Select value={form.status ?? "active"} onValueChange={(v) => v && set("status", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">运行中</SelectItem>
                  <SelectItem value="maintenance">维护中</SelectItem>
                  <SelectItem value="archived">已归档</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>负责人</Label>
              <Input value={form.owner ?? ""} onChange={(e) => set("owner", e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>仓库地址</Label>
            <Input
              value={form.repoUrl ?? ""}
              onChange={(e) => set("repoUrl", e.target.value)}
              placeholder="https://github.com/..."
            />
          </div>
          <div className="space-y-2">
            <Label>标签</Label>
            <Input
              value={form.tags ?? ""}
              onChange={(e) => set("tags", e.target.value)}
              placeholder="后端, docker, 多个用逗号分隔"
            />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Textarea rows={3} value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
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
