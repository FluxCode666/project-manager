import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const COMPOSE = `services:
  aux-system:
    image: ghcr.io/fluxcode666/sub2api-extension:\${TAG:-latest}
    container_name: sub2api-extension
    restart: unless-stopped
    ports:
      - "127.0.0.1:8004:8004"
    environment:
      - AUTO_MIGRATE=true
    volumes:
      - /root/docker-data/aux:/app/data
    networks:
      - sub2api-network

networks:
  sub2api-network:
    external: true
    name: sub2api_sub2api-network
`;

const ENV_B = `# 服务器 B 生产配置
TAG=latest
SUB2API_EXTENSION_SERVER_PORT=8004
BIND_HOST=0.0.0.0
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_USER=aux
DATABASE_PASSWORD=change-me-b
DATABASE_NAME=aux_system
SUB2API_BASE_URL=http://sub2api:8080
SUB2API_EXTENSION_PUBLIC_URL=https://sub2api-extension.teralemo.com
JWT_SECRET=change-me-b
`;

const ENV_C = `# 服务器 C 生产配置
TAG=latest
SUB2API_EXTENSION_SERVER_PORT=8004
BIND_HOST=0.0.0.0
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_USER=aux
DATABASE_PASSWORD=change-me-c
DATABASE_NAME=aux_system
SUB2API_BASE_URL=http://sub2api:8080
SUB2API_EXTENSION_PUBLIC_URL=https://aux.flux-code.cc
JWT_SECRET=change-me-c
`;

async function main() {
  // 清空
  await db.syncLog.deleteMany();
  await db.targetFile.deleteMany();
  await db.deployTarget.deleteMany();
  await db.envFile.deleteMany();
  await db.environment.deleteMany();
  await db.project.deleteMany();
  await db.server.deleteMany();

  // 服务器
  const serverB = await db.server.create({
    data: {
      name: "生产服务器 B",
      host: "203.0.113.10",
      port: 22,
      sshUser: "root",
      sshAuthType: "password",
      sshPassword: "example-password",
      os: "Ubuntu 22.04",
      provider: "Vultr 东京",
      notes: "运行 sub2api 主站及扩展服务",
    },
  });
  const serverC = await db.server.create({
    data: {
      name: "生产服务器 C",
      host: "203.0.113.20",
      port: 22,
      sshUser: "root",
      sshAuthType: "password",
      sshPassword: "example-password",
      os: "Debian 12",
      provider: "Hetzner",
    },
  });

  // 项目 + 环境
  const project = await db.project.create({
    data: {
      name: "aux-system",
      slug: "aux-system",
      description: "Sub2API 扩展系统：docker-compose 部署，生产环境两台服务器",
      owner: "Ethan",
      repoUrl: "https://github.com/fluxcode666/sub2api-extension",
      tags: "Go,React,docker",
    },
  });

  const prod = await db.environment.create({
    data: {
      projectId: project.id,
      name: "生产",
      deployPath: "/opt/sub2api-extension",
      description: "正式环境，b/c 两台服务器",
    },
  });
  const test = await db.environment.create({
    data: {
      projectId: project.id,
      name: "测试",
      deployPath: "/opt/sub2api-extension-test",
      description: "test 分支自动部署",
    },
  });

  // 共享文件
  await db.envFile.create({
    data: { environmentId: prod.id, filename: "docker-compose.yml", content: COMPOSE },
  });
  await db.envFile.create({
    data: { environmentId: test.id, filename: "docker-compose.yml", content: COMPOSE },
  });

  // 部署目标 + 专属 .env
  const targetB = await db.deployTarget.create({
    data: { environmentId: prod.id, serverId: serverB.id },
  });
  const targetC = await db.deployTarget.create({
    data: { environmentId: prod.id, serverId: serverC.id },
  });
  await db.targetFile.create({
    data: { deployTargetId: targetB.id, filename: ".env", content: ENV_B },
  });
  await db.targetFile.create({
    data: { deployTargetId: targetC.id, filename: ".env", content: ENV_C },
  });

  console.log("Seed 完成: 1 项目 / 2 环境 / 2 服务器 / 2 部署目标");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect?.());
