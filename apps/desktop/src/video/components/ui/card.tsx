import type { HTMLAttributes } from "react";

import { cn } from "@video/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement> & { size?: "default" | "sm" }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border py-4 text-sm",
        className,
      )}
      style={{
        backgroundColor: "var(--bg-secondary)",
        borderColor: "var(--border-primary)",
        color: "var(--text-primary)",
      }}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1 px-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-base font-medium", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("text-sm", className)} style={{ color: "var(--text-secondary)" }} {...props} />
  );
}

export function CardAction({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("self-end", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center border-t px-4 pt-3", className)}
      style={{ borderColor: "var(--border-primary)" }}
      {...props}
    />
  );
}
