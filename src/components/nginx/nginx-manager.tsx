"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { OverviewTab } from "./overview-tab";
import { SitesTab } from "./sites-tab";
import { ModulesTab } from "./modules-tab";
import { LogsTab } from "./logs-tab";
import { StatsTab } from "./stats-tab";

export function NginxManager({ serverId }: { serverId: string; serverName: string }) {
  const [tab, setTab] = useState("overview");

  return (
    <Tabs value={tab} onValueChange={(v) => v && setTab(String(v))}>
      <TabsList variant="line" className="w-full max-w-full overflow-x-auto">
        <TabsTrigger value="overview">概览</TabsTrigger>
        <TabsTrigger value="sites">站点</TabsTrigger>
        <TabsTrigger value="modules">模块</TabsTrigger>
        <TabsTrigger value="logs">日志</TabsTrigger>
        <TabsTrigger value="stats">统计</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-6">
        <OverviewTab serverId={serverId} />
      </TabsContent>
      <TabsContent value="sites" className="mt-6">
        <SitesTab serverId={serverId} />
      </TabsContent>
      <TabsContent value="modules" className="mt-6">
        <ModulesTab serverId={serverId} />
      </TabsContent>
      <TabsContent value="logs" className="mt-6">
        <LogsTab serverId={serverId} />
      </TabsContent>
      <TabsContent value="stats" className="mt-6">
        <StatsTab serverId={serverId} />
      </TabsContent>
    </Tabs>
  );
}
