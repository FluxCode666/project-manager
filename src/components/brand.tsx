import { Layers3 } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-primary text-white shadow-sm">
        <Layers3 className="size-5" strokeWidth={1.7} aria-hidden="true" />
      </span>
      <span className="text-left">
        <span className="block text-[15px] font-semibold tracking-tight text-foreground">
          项目管理
        </span>
        {!compact && (
          <span className="mt-0.5 block text-[9px] tracking-[0.1em] whitespace-nowrap text-muted-foreground">
            PROJECT MANAGER
          </span>
        )}
      </span>
    </span>
  );
}
