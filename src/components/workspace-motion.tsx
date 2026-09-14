"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function WorkspaceMotion({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from("[data-enter]", {
          y: 16,
          opacity: 0,
          duration: 0.7,
          stagger: 0.08,
          ease: "power2.out",
          clearProps: "all",
        });
      });
      media.add(
        "(min-width: 1280px) and (min-height: 650px) and (prefers-reduced-motion: no-preference)",
        () => {
          const cards = gsap.utils.toArray<HTMLElement>(
            "[data-stack-card]",
            scope.current,
          );
          const title = scope.current?.querySelector("[data-workflow-title]");
          const last = cards.at(-1);
          if (!last || !title) return;
          ScrollTrigger.create({
            trigger: title,
            start: "top 132px",
            endTrigger: last,
            end: "bottom 420px",
            pin: true,
            pinSpacing: false,
          });
          cards.slice(0, -1).forEach((card, index) => {
            ScrollTrigger.create({
              trigger: card,
              start: `top ${132 + index * 18}px`,
              endTrigger: last,
              end: "top 168px",
              pin: true,
              pinSpacing: false,
            });
            gsap.to(card, {
              scale: 0.96,
              transformOrigin: "top center",
              ease: "none",
              scrollTrigger: {
                trigger: cards[index + 1],
                start: "top 420px",
                end: "top 168px",
                scrub: true,
              },
            });
          });
        },
      );
      return () => media.revert();
    },
    { scope },
  );
  return <div ref={scope}>{children}</div>;
}
