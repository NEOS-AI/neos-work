import type { HTMLAttributes } from "react";

import { cn } from "@video/lib/utils";

type Variant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";

const variants: Record<Variant, string> = {
  default: "bg-blue-600 text-white",
  secondary: "bg-[var(--bg-tertiary)] text-[var(--text-primary)]",
  destructive: "bg-red-950/40 text-red-400",
  outline: "border border-[var(--border-secondary)]",
  ghost: "",
  link: "text-blue-400 underline",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
