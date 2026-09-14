import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-5 py-12 text-center">
      <div className="mb-5 flex size-16 items-center justify-center rounded-2xl border border-primary/10 bg-gradient-to-br from-[#eef3e4] to-[#f8faf3] text-primary/70 [&_svg]:size-7">
        {icon}
      </div>
      <h2 className="text-base font-medium">{title}</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
