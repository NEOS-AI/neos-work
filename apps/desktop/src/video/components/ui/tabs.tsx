import {
  createContext,
  useContext,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@video/lib/utils";

type TabsCtx = {
  value: string;
  setValue: (v: string) => void;
};

const Ctx = createContext<TabsCtx | null>(null);

function useTabs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Tabs parts must be used inside Tabs");
  return ctx;
}

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  className,
  children,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  className?: string;
  children: ReactNode;
  orientation?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const setValue = (v: string) => {
    setInner(v);
    onValueChange?.(v);
  };
  const ctx = useMemo(() => ({ value: current, setValue }), [current]);
  return (
    <Ctx.Provider value={ctx}>
      <div className={cn("flex flex-col gap-2", className)}>{children}</div>
    </Ctx.Provider>
  );
}

export function TabsList({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: string }) {
  return (
    <div
      className={cn("inline-flex w-fit items-center rounded-lg p-1", className)}
      style={{ backgroundColor: "var(--bg-tertiary)" }}
      {...props}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLButtonElement> & { value: string }) {
  const tabs = useTabs();
  const active = tabs.value === value;
  return (
    <button
      type="button"
      className={cn(
        "rounded-md px-2.5 py-1 text-sm",
        active ? "bg-[var(--bg-primary)] font-medium" : "opacity-70 hover:opacity-100",
        className,
      )}
      onClick={() => tabs.setValue(value)}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { value: string }) {
  const tabs = useTabs();
  if (tabs.value !== value) return null;
  return (
    <div className={cn("text-sm", className)} {...props}>
      {children}
    </div>
  );
}
