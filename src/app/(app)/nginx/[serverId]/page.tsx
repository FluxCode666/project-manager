import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { NginxManager } from "@/components/nginx/nginx-manager";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  online: { label: "在线", variant: "default" },
  offline: { label: "离线", variant: "destructive" },
  maintenance: { label: "维护中", variant: "secondary" },
};

export default async function NginxServerPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  const server = await db.server.findUnique({ where: { id: serverId } });
  if (!server) notFound();

  const st = STATUS_BADGE[server.status] ?? STATUS_BADGE.online;

  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="break-words">{server.name} · Nginx</h1>
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {server.host}:{server.port}
          </p>
        </div>
        <Link href="/nginx" className={buttonVariants({ variant: "outline", size: "sm" })}>
          ← 返回列表
        </Link>
      </div>

      <NginxManager serverId={serverId} serverName={server.name} />
    </div>
  );
}
