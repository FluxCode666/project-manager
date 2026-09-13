/**
 * 轻量 WebDAV 客户端（Basic Auth + fetch），覆盖备份所需操作：
 * PUT 上传 / MKCOL 建目录 / PROPFIND 列目录 / DELETE 删除
 */

export interface WebdavConfig {
  url: string; // 服务器根，如 https://dav.example.com/dav
  username: string;
  password: string;
}

function authHeaders(cfg: WebdavConfig): Record<string, string> {
  const basic = Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  return { Authorization: `Basic ${basic}` };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** 上传文件 */
export async function webdavPut(cfg: WebdavConfig, remotePath: string, body: Buffer | string, contentType = "application/octet-stream"): Promise<void> {
  const res = await fetch(joinUrl(cfg.url, remotePath), {
    method: "PUT",
    headers: { ...authHeaders(cfg), "Content-Type": contentType },
    body: body as BodyInit,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    throw new Error(`WebDAV PUT 失败: ${res.status} ${res.statusText}`);
  }
}

/** 逐级创建目录（忽略已存在） */
export async function webdavMkdirs(cfg: WebdavConfig, remotePath: string): Promise<void> {
  const parts = remotePath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = `${current}/${part}`;
    const res = await fetch(joinUrl(cfg.url, current), {
      method: "MKCOL",
      headers: authHeaders(cfg),
      signal: AbortSignal.timeout(15000),
    });
    // 405 = 已存在，201 = 创建成功，都算通过
    if (!res.ok && res.status !== 201 && res.status !== 405) {
      throw new Error(`WebDAV MKCOL ${current} 失败: ${res.status} ${res.statusText}`);
    }
  }
}

export interface WebdavFile {
  name: string;
  size: number;
  lastModified: string | null;
}

/** 列目录（PROPFIND Depth:1，解析 XML 里的文件名与 getcontentlength） */
export async function webdavList(cfg: WebdavConfig, remotePath: string): Promise<WebdavFile[]> {
  const res = await fetch(joinUrl(cfg.url, remotePath), {
    method: "PROPFIND",
    headers: { ...authHeaders(cfg), Depth: "1", "Content-Type": "application/xml" },
    body: `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>`,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok && res.status !== 207) {
    throw new Error(`WebDAV PROPFIND 失败: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();

  const files: WebdavFile[] = [];
  // 按 response 块解析，跳过目录本身（第一个 response）
  const responses = xml.split(/<d?:?response[\s>]/i).slice(1);
  const dirPath = remotePath.replace(/\/+$/, "");
  for (const block of responses) {
    const hrefMatch = block.match(/<d?:?href[^>]*>([^<]+)<\/d?:?href>/i);
    if (!hrefMatch) continue;
    let href = decodeURIComponent(hrefMatch[1]);
    // 跳过目录自身（href 以 / 结尾 或 与 dirPath 匹配）
    if (href.endsWith("/")) continue;
    if (dirPath && (href === dirPath || href.endsWith(dirPath))) continue;

    const name = href.split("/").filter(Boolean).pop();
    if (!name) continue;

    const sizeMatch = block.match(/<d?:?getcontentlength[^>]*>(\d+)<\/d?:?getcontentlength>/i);
    const modMatch = block.match(/<d?:?getlastmodified[^>]*>([^<]+)<\/d?:?getlastmodified>/i);
    files.push({
      name,
      size: sizeMatch ? parseInt(sizeMatch[1], 10) : 0,
      lastModified: modMatch ? modMatch[1] : null,
    });
  }
  return files;
}

/** 删除远端文件 */
export async function webdavDelete(cfg: WebdavConfig, remotePath: string): Promise<void> {
  const res = await fetch(joinUrl(cfg.url, remotePath), {
    method: "DELETE",
    headers: authHeaders(cfg),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`WebDAV DELETE 失败: ${res.status} ${res.statusText}`);
  }
}

/** 连接测试：PROPFIND 根目录 */
export async function webdavTest(cfg: WebdavConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, "") + "/", {
      method: "PROPFIND",
      headers: { ...authHeaders(cfg), Depth: "0" },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 207) return { ok: true, message: "连接成功" };
    if (res.status === 401) return { ok: false, message: "认证失败（用户名或密码错误）" };
    if (res.status === 404) return { ok: false, message: "路径不存在（404），检查 WebDAV URL" };
    return { ok: false, message: `意外响应: ${res.status} ${res.statusText}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message || "连接失败" };
  }
}
