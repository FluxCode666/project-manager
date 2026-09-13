#!/bin/sh
set -e

# 自更新机制：
# - /versions/current 符号链接指向已解压的新版本目录（含完整 standalone 产物 + node_modules）
# - entrypoint 优先加载该目录，不存在则回退到镜像内置的 /app
# - 新版本启动时自动执行数据库迁移（幂等）

if [ -d "/versions/current" ] && [ -f "/versions/current/server.js" ]; then
  echo "[entrypoint] 检测到更新版本，加载 /versions/current"
  cd /versions/current
else
  echo "[entrypoint] 使用镜像内置版本"
  cd /app
fi

# 数据库目录
mkdir -p /data

# 启动时执行迁移（幂等；AUTO_MIGRATE=false 可禁用）
export RUN_MIGRATIONS=1

echo "[entrypoint] 启动 project-manager $(cat VERSION 2>/dev/null || echo dev)"
exec node server.js
