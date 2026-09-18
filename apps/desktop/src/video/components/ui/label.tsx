import type { LabelHTMLAttributes } from "react";

import { cn } from "@video/lib/utils";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("flex items-center gap-2 text-sm font-medium", className)}
      style={{ color: "var(--text-primary)" }}
      {...props}
    />
  );
}
