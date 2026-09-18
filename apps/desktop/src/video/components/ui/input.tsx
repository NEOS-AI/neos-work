import type { InputHTMLAttributes } from "react";

import { cn } from "@video/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border px-2.5 text-sm outline-none",
        className,
      )}
      style={{
        backgroundColor: "var(--input-bg)",
        borderColor: "var(--border-secondary)",
        color: "var(--text-primary)",
      }}
      {...props}
    />
  );
}
