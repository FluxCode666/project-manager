# Project Manager NGINX 配置

参考 `aux-system/deploy/nginx` 的宿主机反向代理结构，适用于本项目的 Docker Compose 生产部署：

```text
浏览器 → 宿主机 NGINX（80 / 443）→ 127.0.0.1:3000 → project-manager 容器
```

## 配置文件

- `nginx.conf`：可选的宿主机主配置，默认使用 Debian/Ubuntu 的 `www-data` 用户；其他发行版需改为实际 NGINX 用户。
- `conf.d/project-manager.conf`：站点配置，包含 HTTP 跳转 HTTPS、TLS、ACME 验证目录与反向代理。可单独加入已有 NGINX，不依赖自定义日志格式、变量或 snippets。

默认域名为 `project-manager.example.com`，部署前须替换为真实域名。配置用于独立域名的根路径，不使用子路径前缀。

## 安装

1. 在项目根目录按主 README 启动 Docker Compose。保持 `.env` 中 `BIND_IP=127.0.0.1`、`SERVER_PORT=3000`；如果修改 `SERVER_PORT`，同时修改站点配置中的 upstream 端口。

   ```bash
   docker compose up -d
   curl -I http://127.0.0.1:3000/login
   ```

2. 将站点配置中所有 `project-manager.example.com` 替换为实际域名，包括 `server_name`、跳转地址和证书路径。将域名解析到服务器，并准备证书：

   ```text
   /etc/nginx/certs/<你的域名>/fullchain.pem
   /etc/nginx/certs/<你的域名>/privkey.pem
   ```

   完整 HTTPS 配置需要证书已存在才能通过 `nginx -t`。如果首次使用 ACME HTTP-01 签发证书，可先仅安装文件中的 80 端口 `server` 块，使用 `/var/www/html` 作为 webroot；签发并放置证书后再安装完整配置。ACME 路径不会跳转到 HTTPS。

3. 从项目根目录安装站点配置：

   ```bash
   sudo install -Dm644 deploy/nginx/conf.d/project-manager.conf /etc/nginx/conf.d/project-manager.conf
   ```

   已有 NGINX（包括运行 aux-system 的服务器）保留原主配置，确认其 `http` 块包含 `include /etc/nginx/conf.d/*.conf;` 即可。

   新服务器若使用本项目的主配置，再执行：

   ```bash
   sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak
   sudo install -Dm644 deploy/nginx/nginx.conf /etc/nginx/nginx.conf
   ```

4. 检查并加载：

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

   配置沿用参考项目的 `listen 443 ssl http2;`，兼容 NGINX 1.24。NGINX 1.25.1+ 如提示此语法弃用，可替换为以下两行：

   ```nginx
   listen 443 ssl;
   http2 on;
   ```

## 验证

将以下地址中的域名替换为真实域名后执行：

```bash
# 返回 308，Location 保留路径和查询参数并指向 HTTPS
curl -I 'http://project-manager.example.com/login?from=nginx'

# 返回 204，仅检查 NGINX 存活
curl -I https://project-manager.example.com/nginx-health

# 返回 200，检查应用登录页
curl -I https://project-manager.example.com/login

# 未登录返回 401，检查 API 反代和鉴权
curl -i https://project-manager.example.com/api/projects
```

随后在浏览器中登录，检查页面导航、项目列表和静态资源加载。

## 与 Next.js 配合

- 页面与 API 关闭代理响应缓冲，支持 App Router 流式渲染；`/_next/static/` 保留缓冲，并透传 Next.js 自带的缓存头。
- NGINX 不启用代理缓存，不覆盖 `Cache-Control` / `Vary`，让 Next.js 控制页面、RSC 和静态文件的缓存行为。
- 转发原始域名、HTTPS 协议、客户端 IP 和 Cookie，登录及重定向均通过同一 HTTPS 域名访问。
- 一般请求的上游读取超时为 300 秒；批量同步、自更新和手动备份为 1800 秒。这是两次上游读取之间的等待时间，不会延长应用自身的超时；大批量同步超过 30 分钟时可调整对应 location。
- 请求体限制为 10 MiB，用于保存部署文件等请求；需要更大内容时调整站点的 `client_max_body_size`。WebDAV 备份与更新包下载由应用直接访问外部服务，不经过此请求体限制。
- 静态资源始终通过应用提供，无需挂载 `.next/static` 到宿主机，自更新切换版本后自动使用新资源。
- `/nginx-health` 在应用停止时仍返回 204；本项目没有匿名应用 `/health` 接口。

站点日志位于 `/var/log/nginx/project-manager.access.log` 和 `/var/log/nginx/project-manager.error.log`。
