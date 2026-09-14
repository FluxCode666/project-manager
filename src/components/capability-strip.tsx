"use client";

import { useState } from "react";
import { CloudUpload, FolderKanban, Pause, Play, Server } from "lucide-react";
import styles from "./capability-strip.module.css";

const capabilities = [
  {
    title: "项目井然有序",
    description: "档案、负责人和环境，一个空间集中管理。",
    icon: FolderKanban,
  },
  {
    title: "基础设施在握",
    description: "归集服务器资产，让每个部署目标清晰可见。",
    icon: Server,
  },
  {
    title: "每次交付可循",
    description: "同步部署配置，保留完整执行与备份记录。",
    icon: CloudUpload,
  },
];

export function CapabilityStrip() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  return (
    <div className="mx-auto mt-10 w-full max-w-5xl">
      <div
        className="flex flex-col gap-3 sm:flex-row"
        onMouseLeave={() => setActive(0)}
      >
        {capabilities.map((item, index) => (
          <button
            key={item.title}
            type="button"
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onClick={() => setActive(index)}
            aria-expanded={active === index}
            aria-controls={`capability-${index}`}
            className={`${styles.panel} ${active === index ? styles.active : ""}`}
          >
            <item.icon
              className="size-5 shrink-0 text-primary"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <span>
              <span className="block text-xs font-medium">{item.title}</span>
              <span
                id={`capability-${index}`}
                className={`${styles.description} ${active === index ? styles.visible : ""}`}
              >
                {item.description}
              </span>
            </span>
          </button>
        ))}
      </div>
      <div className="mt-7 flex items-center gap-4">
        <div className={styles.marquee} aria-hidden="true">
          <div
            className={styles.track}
            style={{ animationPlayState: paused ? "paused" : "running" }}
          >
            {[0, 1].map((copy) => (
              <span key={copy}>
                PROJECTS <i /> SERVERS <i /> ENVIRONMENTS <i /> DEPLOYMENTS{" "}
                <i /> BACKUPS <i />
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPaused(!paused)}
          aria-label={paused ? "播放装饰文字动画" : "暂停装饰文字动画"}
          aria-pressed={paused}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          {paused ? (
            <Play className="size-3" aria-hidden="true" />
          ) : (
            <Pause className="size-3" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
