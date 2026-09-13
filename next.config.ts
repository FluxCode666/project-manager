import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ssh2 含原生绑定，不能被 Turbopack 打包进 ESM chunk
  serverExternalPackages: ["ssh2", "better-sqlite3"],
  // 允许 127.0.0.1 访问 dev 资源（HMR 热更新）
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
