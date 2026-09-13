# ---------- deps ----------
FROM node:22-alpine AS deps
# better-sqlite3 原生编译需要
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- builder ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG APP_VERSION=dev
ENV NEXT_TELEMETRY_DISABLED=1
# 构建期 DATABASE_URL 仅类型需要，不实际连接
ENV DATABASE_URL="file:./build-placeholder.db"

# 生成 prisma client + 构建 standalone 产物
RUN npx prisma generate && npm run build
# 写入版本文件（运行时读取）
RUN echo -n "${APP_VERSION}" > VERSION
# standalone 产物不含 node_modules 全量，运行时需要原生模块和 prisma client
RUN cp -r node_modules/better-sqlite3* .standalone-node-better-sqlite3 2>/dev/null; \
    mkdir -p /out && \
    cp -r .next/standalone /out/app && \
    cp -r .next/static /out/app/.next/static && \
    cp -r public /out/app/public 2>/dev/null || true && \
    cp -r prisma /out/app/prisma && \
    cp VERSION /out/app/VERSION && \
    cd /out/app && \
    npm install --omit=dev better-sqlite3 @prisma/adapter-better-sqlite3 ssh2 2>/dev/null; \
    true

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app

# tar/gzip 用于应用内自更新解压
RUN apk add --no-cache tar

# 运行目录：/versions/<tag> 由自更新写入，/app 为镜像内置版本
COPY --from=builder /out/app ./

# 自更新加载目录（挂载卷）
ENV UPDATES_DIR=/versions
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATABASE_URL="file:/data/project-manager.db"

VOLUME ["/data", "/versions"]

EXPOSE 3000

COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
