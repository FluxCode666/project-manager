# 团队项目管理系统

小团队内部使用的项目管理系统：**项目档案 + 服务器资产 + 项目维度部署配置管理 + SSH 同步到服务器**。

核心场景：项目（如 aux-system）生产环境用 docker-compose 部署，本系统维护 `docker-compose.yml`（环境级共享文件）和各服务器独立的 `.env`（目标级专属文件），配置好后一键同步到各台服务器的指定目录，可选自动执行 `docker compose up -d` 等命令。

## 技术栈

- Next.js 16（App Router, TypeScript, Turbopack）
- Prisma 7 + SQLite（better-sqlite3 driver adapter）
- shadcn/ui + Tailwind CSS
- ssh2（SFTP 写入 + 远程命令执行）
- jose（HMAC 签名 session cookie）

## 快速开始

```bash
npm install

# 配置环境变量
cp .env.example .env   # 或手动创建，见下

# 初始化数据库
npx prisma migrate dev

# （可选）写入示例数据：1 项目 / 2 环境 / 2 服务器 / 部署目标
npx tsx prisma/seed.ts

npm run dev
```

打开 http://localhost:3000 ，输入 `.env` 中的 `APP_PASSWORD` 登录。

## 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | SQLite 路径，如 `file:./dev.db` |
| `APP_PASSWORD` | 登录密码 |
| `AUTH_SECRET` | session 签名密钥，生产环境务必换成随机长字符串 |

## 功能

### 项目管理
项目 CRUD：名称、状态（运行中/维护中/归档）、负责人、仓库地址、标签、描述。

### 服务器资产
服务器 CRUD：主机/端口、SSH 用户、认证方式（密码/私钥）、供应商、操作系统、备注。
一键「测试连接」验证 SSH 凭据并更新在线状态。

### 环境与部署文件（核心）

数据模型分为两层：

```
项目 Project
 └─ 环境 Environment（生产/测试/开发，各配一个服务器部署目录 deployPath）
     ├─ 共享文件 EnvFile     —— 所有服务器共用（如 docker-compose.yml）
     └─ 部署目标 DeployTarget —— 环境 × 服务器（支持多台）
         └─ 专属文件 TargetFile —— 该服务器独立配置（如 .env）
```

**同步合并规则**：目标目录最终文件 = 环境级共享文件 + 该目标专属文件（同名时专属文件覆盖共享文件）。

同步流程：SSH 连接 → `mkdir -p` 部署目录 → 逐文件写入（先写 `.pm.tmp` 再 rename 原子替换）→ 可选执行部署命令 → 记录同步日志。

专属文件编辑器支持「从服务器拉取」，把远端现有内容回填到编辑器核对后再保存。

### 同步日志
每次同步记录：状态、文件数、执行的命令、命令输出/错误信息、耗时，分页查看。

### 备份（WebDAV）

侧边栏「备份」页配置：

- **WebDAV 目标**：地址 + 目录 + 账号密码（坚果云 / Nextcloud / Alist 等标准 WebDAV 均可），保存时自动测试连接并创建目录
- **备份内容**：`VACUUM INTO` 生成一致性 SQLite 快照（写入并发下也安全）→ gzip → 上传，文件名含时间戳 + 内容 sha256
- **定时**：每 6/12/24 小时或每周自动执行（instrumentation 调度器，每 30 分钟检查，容器重启/自更新后自动恢复）
- **保留数**：超出保留数量的旧备份自动清理（只清理本系统命名规则的文件）
- 备份记录与远端文件列表在页面上可见

恢复：下载 `.db.gz` → `gunzip` → 替换 `data/project-manager.db` → 重启容器。

## 部署

### Docker Compose（推荐）

```bash
mkdir project-manager && cd project-manager
curl -O https://raw.githubusercontent.com/fluxcode666/project-manager/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/fluxcode666/project-manager/main/.env.docker.example
# 编辑 .env：设置 APP_PASSWORD、AUTH_SECRET
docker compose up -d
```

- 数据库落在 `./data/project-manager.db`（SQLite，自动执行迁移）
- `./versions` 为应用内自更新的版本目录
- 默认只绑 `127.0.0.1:3000`，对外请用 Nginx/Caddy 反代

### NGINX HTTPS 反向代理

已提供 [NGINX 配置与安装说明](deploy/nginx/README.md)，沿用 `aux-system/deploy/nginx` 的宿主机部署结构。将站点配置中的 `project-manager.example.com` 替换为真实域名、准备 TLS 证书后，即可反代到 `127.0.0.1:3000`；已适配 Next.js 流式响应及同步、备份、自更新的长请求。

### 应用内自更新

1. 推送 tag（如 `v1.0.1`）触发 GitHub Actions：
   - 构建 `project-manager-<tag>.tar.gz` 更新包 + `.sha256`，发布 GitHub Release
   - 构建并推送 amd64/arm64 多架构镜像到 GHCR
2. 管理员在页面侧边栏底部点击**版本号**，弹窗内：
   - 查看当前版本 / 最新 release / 更新日志
   - 点击「立即更新」：系统下载 tarball → sha256 校验 → 解压到 `/versions/<tag>/` → rebuild 原生模块 → 原子切换 `/versions/current` 符号链接 → 自动重启
   - 前端轮询服务恢复后自动刷新，全程无需登录服务器

> `GITHUB_REPO` 环境变量控制检查更新的仓库；私有仓库需配置 `GITHUB_TOKEN`。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATABASE_URL` | `file:/data/project-manager.db` | SQLite 路径 |
| `APP_PASSWORD` | 必填 | 登录密码 |
| `AUTH_SECRET` | 必填 | session 签名密钥 |
| `GITHUB_REPO` | - | 检查更新用的仓库，如 `fluxcode666/project-manager` |
| `GITHUB_TOKEN` | - | 私有仓库需要 |
| `AUTO_MIGRATE` | `true` | 启动时自动执行数据库迁移 |
| `BIND_IP` / `SERVER_PORT` / `TAG` | `127.0.0.1` / `3000` / `latest` | compose 监听与镜像版本 |

## 注意事项

- SSH 凭据与 env 内容为**明文存储**在 SQLite 中，请从运维层面保护好数据库文件与服务器访问权限
- 同步命令在服务器上以 SSH 用户身份执行，建议使用受限账号而非直接 root（按需）
- 首次对一个已有部署的服务器使用时，可先「从服务器拉取」现有 env 核对，避免覆盖线上配置
