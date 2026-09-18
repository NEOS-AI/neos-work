import type { ButtonHTMLAttributes } from "react";

import { cn } from "@video/lib/utils";

type Variant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
type Size = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

const variants: Record<Variant, string> = {
  default: "bg-blue-600 text-white hover:bg-blue-500",
  outline: "border border-[var(--border-secondary)] bg-transparent hover:bg-[var(--bg-tertiary)]",
  secondary: "bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--border-secondary)]",
  ghost: "hover:bg-[var(--bg-tertiary)]",
  destructive: "bg-red-950/40 text-red-400 hover:bg-red-950/60",
  link: "text-blue-400 underline-offset-4 hover:underline",
};

const sizes: Record<Size, string> = {
  default: "h-8 px-2.5 text-sm",
  xs: "h-6 px-2 text-xs",
  sm: "h-7 px-2.5 text-xs",
  lg: "h-9 px-3 text-sm",
  icon: "size-8",
  "icon-xs": "size-6",
  "icon-sm": "size-7",
  "icon-lg": "size-9",
};

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
