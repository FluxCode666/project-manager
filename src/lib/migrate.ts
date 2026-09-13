import fs from "fs";
import path from "path";
import crypto from "crypto";
import Database from "better-sqlite3";

/**
 * 应用内启动迁移执行器（等价 prisma migrate deploy）。
 * 容器内没有 prisma CLI，用 better-sqlite3 同步执行 prisma/migrations 下的 SQL，
 * 写入的 _prisma_migrations 记录格式与 Prisma CLI 完全兼容（checksum = 文件 sha256），
 * 之后在开发机对同一数据库跑 `prisma migrate dev` 也能正确识别。
 */
let migrationsDone = false;

export function runMigrations(dbUrl: string): void {
  if (process.env.AUTO_MIGRATE === "false") return;
  // Next 单进程内可能多次实例化 client，只执行一次
  if (migrationsDone) return;
  migrationsDone = true;

  const dbFile = dbUrl.replace(/^file:/, "");
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");

  if (!fs.existsSync(migrationsDir)) {
    console.log("[migrate] 未找到迁移目录，跳过");
    return;
  }

  const db = new Database(dbFile);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
          "id"                    TEXT PRIMARY KEY NOT NULL,
          "checksum"              TEXT NOT NULL,
          "finished_at"           DATETIME,
          "migration_name"        TEXT NOT NULL,
          "logs"                  TEXT,
          "rolled_back_at"        DATETIME,
          "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
          "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
      );
    `);

    const applied = new Set(
      (db.prepare("SELECT migration_name FROM _prisma_migrations").all() as { migration_name: string }[]).map(
        (r) => r.migration_name
      )
    );

    const dirs = fs
      .readdirSync(migrationsDir)
      .filter((d) => fs.statSync(path.join(migrationsDir, d)).isDirectory())
      .sort();

    let count = 0;
    for (const dir of dirs) {
      if (applied.has(dir)) continue;
      const sqlPath = path.join(migrationsDir, dir, "migration.sql");
      if (!fs.existsSync(sqlPath)) continue;

      const sql = fs.readFileSync(sqlPath, "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const now = new Date().toISOString();

      db.exec("BEGIN");
      try {
        db.exec(sql);
        db.prepare(
          `INSERT INTO "_prisma_migrations"
             ("id", "checksum", "finished_at", "migration_name", "applied_steps_count", "started_at")
           VALUES (?, ?, ?, ?, 1, ?)`
        ).run(crypto.randomUUID(), checksum, now, dir, now);
        db.exec("COMMIT");
        count++;
        console.log(`[migrate] 已应用: ${dir}`);
      } catch (e) {
        db.exec("ROLLBACK");
        throw new Error(`迁移 ${dir} 失败: ${(e as Error).message}`);
      }
    }

    if (count === 0) console.log("[migrate] 数据库已是最新");
  } finally {
    db.close();
  }
}
