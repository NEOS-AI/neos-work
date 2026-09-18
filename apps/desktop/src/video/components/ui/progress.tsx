import type { HTMLAttributes } from "react";

import { cn } from "@video/lib/utils";

export function Progress({
  value = 0,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { value?: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full", className)}
      style={{ backgroundColor: "var(--bg-tertiary)" }}
      {...props}
    >
      <div className="h-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}
