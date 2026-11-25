// 客户端请求 JSON：非 2xx 时抛出接口返回的 error 字段，便于在 promise 链中统一处理失败
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `请求失败（${res.status}）`);
  return data as T;
}
