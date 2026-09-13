/**
 * 备份定时调度器（仅 nodejs runtime，由 instrumentation.ts 加载）
 */
import { db } from "@/lib/db";
import { runBackup } from "@/lib/backup";

export function startBackupScheduler() {
  const CHECK_INTERVAL_MS = 30 * 60 * 1000;

  async function checkAndBackup() {
    try {
      const config = await db.backupConfig.findUnique({ where: { id: "default" } });
      if (!config?.enabled || !config.webdavUrl || !config.cronEvery) return;

      const last = config.lastRunAt?.getTime() ?? 0;
      const due = Date.now() - last >= config.cronEvery * 3600 * 1000;
      if (due) {
        console.log("[backup-scheduler] 触发定时备份");
        const result = await runBackup("scheduled");
        if (result.ok) {
          console.log(`[backup-scheduler] 备份成功: ${result.fileName}`);
        } else {
          console.warn(`[backup-scheduler] 备份失败: ${result.error}`);
        }
      }
    } catch (e) {
      console.warn("[backup-scheduler] 检查异常:", e);
    }
  }

  // 启动后延迟 1 分钟做首次检查，避开启动高峰
  setTimeout(() => {
    checkAndBackup();
    setInterval(checkAndBackup, CHECK_INTERVAL_MS);
  }, 60 * 1000);
}
