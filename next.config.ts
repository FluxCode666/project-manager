import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ssh2 含原生绑定，不能被 Turbopack 打包进 ESM chunk
  serverExternalPackages: ["ssh2", "better-sqlite3"],
};

export default nextConfig;
