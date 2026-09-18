import type { HTMLAttributes } from "react";

import { cn } from "@video/lib/utils";

export function Separator({
  className,
  orientation = "horizontal",
  ...props
}: HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical" }) {
  return (
    <div
      className={cn(
        orientation === "vertical" ? "w-px self-stretch" : "h-px w-full",
        className,
      )}
      style={{ backgroundColor: "var(--border-primary)" }}
      {...props}
    />
  );
}
