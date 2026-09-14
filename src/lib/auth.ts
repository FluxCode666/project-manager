import { db } from "@/lib/db";

// 密码可被数据库设置覆盖（页面内修改），无覆盖时回落到环境变量 APP_PASSWORD
// 注意：session 相关在 session.ts（Edge 兼容），此文件仅 Node runtime 使用

let cachedPassword: { value: string | null; at: number } | null = null;
const PASSWORD_CACHE_MS = 30 * 1000;

async function getEffectivePassword(): Promise<string> {
  // 开发环境不缓存，改了立刻生效
  const useCache = process.env.NODE_ENV === "production";
  if (useCache && cachedPassword && Date.now() - cachedPassword.at < PASSWORD_CACHE_MS) {
    if (cachedPassword.value !== null) return cachedPassword.value;
  }

  let fromDb: string | null = null;
  try {
    const setting = await db.appSetting.findUnique({ where: { key: "app_password" } });
    fromDb = setting?.value ?? null;
  } catch {
    fromDb = null; // 表不存在（未迁移）等异常回落到环境变量
  }

  const effective = fromDb ?? process.env.APP_PASSWORD;
  if (!effective) throw new Error("APP_PASSWORD is not set");
  if (useCache) cachedPassword = { value: fromDb, at: Date.now() };
  return effective;
}

/** 清除密码缓存（修改密码后调用，立即生效） */
export function invalidatePasswordCache() {
  cachedPassword = null;
}

export async function checkPassword(password: string): Promise<boolean> {
  const expected = await getEffectivePassword();
  return password === expected;
}
