import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

import { cn } from "@video/lib/utils";

type Item = { value: string; label: string };

type SelectCtx = {
  value?: string;
  onValueChange?: (v: string) => void;
  disabled?: boolean;
  items: Item[];
  register: (item: Item) => void;
};

const Ctx = createContext<SelectCtx | null>(null);

function useSelect() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Select parts must be used inside Select");
  return ctx;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

export function Select({
  value,
  onValueChange,
  disabled,
  children,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const register = useCallback((item: Item) => {
    setItems((prev) => (prev.some((p) => p.value === item.value) ? prev : [...prev, item]));
  }, []);
  const ctx = useMemo(
    () => ({ value, onValueChange, disabled, items, register }),
    [value, onValueChange, disabled, items, register],
  );
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function SelectTrigger({
  className,
  children: _children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { size?: string }) {
  const ctx = useSelect();
  return (
    <select
      className={cn("h-8 w-full min-w-[8rem] rounded-lg border px-2 text-sm outline-none", className)}
      style={{
        backgroundColor: "var(--input-bg)",
        borderColor: "var(--border-secondary)",
        color: "var(--text-primary)",
      }}
      value={ctx.value}
      disabled={ctx.disabled || props.disabled}
      onChange={(e) => ctx.onValueChange?.(e.target.value)}
    >
      {ctx.items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

export function SelectValue(_props: { placeholder?: string; className?: string }) {
  return null;
}

export function SelectContent({ children }: { children: ReactNode; className?: string }) {
  return <>{children}</>;
}

export function SelectGroup({ children }: { children: ReactNode; className?: string }) {
  return <>{children}</>;
}

export function SelectLabel(_props: { children?: ReactNode; className?: string }) {
  return null;
}

export function SelectItem({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useSelect();
  const label = textOf(children);
  useLayoutEffect(() => {
    ctx.register({ value, label });
  }, [ctx, value, label]);
  return null;
}
