import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { runMigrations } from "@/lib/migrate";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // 仅在显式声明 RUN_MIGRATIONS=1 时执行启动迁移
  // （Docker entrypoint/部署脚本设置；Next build 期间也会实例化 client，不能跑迁移）
  if (process.env.RUN_MIGRATIONS === "1") {
    try {
      runMigrations(process.env.DATABASE_URL!);
    } catch (e) {
      console.error("[migrate] 启动迁移失败:", e);
      throw e;
    }
  }
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type { PrismaClient };
