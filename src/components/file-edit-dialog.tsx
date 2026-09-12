"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export interface FileData {
  id: string;
  filename: string;
  content: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  file: FileData | null;
  filenameLocked?: boolean; // 编辑模式下文件名不可改
  onSave: (filename: string, content: string) => Promise<void>;
  onFetchRemote?: () => Promise<void>; // 拉取服务器现有内容
}

export function FileEditDialog({ open, onOpenChange, title, file, filenameLocked, onSave, onFetchRemote }: Props) {
  const [filename, setFilename] = useState(file?.filename ?? "");
  const [content, setContent] = useState(file?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastLoaded, setLastLoaded] = useState(file?.filename ?? "");

  // 对话框打开时若切换了文件则重置
  if (file && file.filename !== lastLoaded) {
    setFilename(file.filename);
    setContent(file.content);
    setLastLoaded(file.filename);
    setDirty(false);
  }

  async function handleSave() {
    if (!filename.trim()) {
      toast.error("文件名不能为空");
      return;
    }
    setSaving(true);
    try {
      await onSave(filename.trim(), content);
      setDirty(false);
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const lineCount = content.split("\n").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title}
            {dirty && <Badge variant="secondary">未保存</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            value={filename}
            onChange={(e) => {
              setFilename(e.target.value);
              setDirty(true);
            }}
            disabled={filenameLocked}
            placeholder="docker-compose.yml / .env"
            className="w-64 font-mono text-sm"
          />
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {lineCount} 行 · {content.length} 字符
            </span>
            {onFetchRemote && (
              <Button variant="outline" size="sm" onClick={onFetchRemote}>
                从服务器拉取
              </Button>
            )}
          </div>
        </div>
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          spellCheck={false}
          className="flex-1 resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none focus:ring-1 focus:ring-ring"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !filename.trim()}>
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
