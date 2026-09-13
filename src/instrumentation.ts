/**
 * Next instrumentation hook：服务启动时拉起备份定时调度器。
 * 此文件会被 Edge 和 Node 两个 runtime 加载——调度器（含 better-sqlite3 原生模块）
 * 只在 nodejs 分支内动态加载，Edge 分支直接返回。
 */
const globalForScheduler = globalThis as unknown as { __backupSchedulerStarted?: boolean };

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalForScheduler.__backupSchedulerStarted) return;
  globalForScheduler.__backupSchedulerStarted = true;

  const { startBackupScheduler } = await import("@/lib/scheduler");
  startBackupScheduler();
  console.log("[backup-scheduler] 已启动（每 30 分钟检查）");
}
