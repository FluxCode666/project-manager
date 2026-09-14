"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LogData {
  id: string;
  status: string;
  filesSynced: number;
  commandExecuted?: string | null;
  output?: string | null;
  errorMessage?: string | null;
  durationMs: number;
  createdAt: string;
  deployTarget: {
    server: { name: string; host: string };
    environment: { name: string; project: { name: string } };
  } | null;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<LogData | null>(null);
  const pageSize = 20;

  async function load(p: number) {
    setLoading(true);
    const res = await fetch(`/api/logs?page=${p}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
    }
    setLoading(false);
  }

  useEffect(() => {
    load(page);
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
        <h1 className="text-2xl font-semibold">同步日志</h1>
        <p className="text-sm text-muted-foreground">所有部署文件同步记录（共 {total} 条）</p>
        </div>
      </div>

      <Card>
        <CardContent>
          {loading ? (
            <div role="status" aria-label="正在加载同步记录" className="space-y-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-16" />)}</div>
          ) : logs.length === 0 ? (
            <EmptyState icon={<RefreshCw strokeWidth={1.5} />} title="每一次同步，都有记录" description="完成首次部署文件同步后，在这里查看执行结果、文件数量与详细日志。" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>时间</TableHead>
                  <TableHead>项目 / 环境</TableHead>
                  <TableHead>服务器</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>文件数</TableHead>
                  <TableHead>耗时</TableHead>
                  <TableHead>命令</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(log.createdAt).toLocaleString("zh-CN")}
                    </TableCell>
                    <TableCell>
                      {log.deployTarget ? (
                        <>
                          <div className="text-sm font-medium">{log.deployTarget.environment.project.name}</div>
                          <div className="text-xs text-muted-foreground">{log.deployTarget.environment.name}</div>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">目标已删除</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.deployTarget?.server.name ?? "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={log.status === "success" ? "default" : "destructive"}>
                        {log.status === "success" ? "成功" : "失败"}
                      </Badge>
                    </TableCell>
                    <TableCell>{log.filesSynced}</TableCell>
                    <TableCell className="text-sm">{log.durationMs}ms</TableCell>
                    <TableCell className="max-w-40 truncate font-mono text-xs">
                      {log.commandExecuted || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDetail(log)}>
                        详情
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            下一页
          </Button>
        </div>
      )}

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>同步详情</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground">状态：</span>
                  <Badge variant={detail.status === "success" ? "default" : "destructive"}>
                    {detail.status === "success" ? "成功" : "失败"}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">耗时：</span>
                  {detail.durationMs}ms
                </div>
                <div>
                  <span className="text-muted-foreground">文件数：</span>
                  {detail.filesSynced}
                </div>
                <div>
                  <span className="text-muted-foreground">时间：</span>
                  {new Date(detail.createdAt).toLocaleString("zh-CN")}
                </div>
              </div>
              {detail.commandExecuted && (
                <div>
                  <span className="text-muted-foreground">执行的命令：</span>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                    {detail.commandExecuted}
                  </pre>
                </div>
              )}
              {detail.output && (
                <div>
                  <span className="text-muted-foreground">命令输出：</span>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-xs">
                    {detail.output}
                  </pre>
                </div>
              )}
              {detail.errorMessage && (
                <div>
                  <span className="text-destructive">错误信息：</span>
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-destructive/10 p-2 font-mono text-xs text-destructive">
                    {detail.errorMessage}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
