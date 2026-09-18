import { useEffect, useState } from "react";

export type ToastOptions = {
  description?: string;
  action?: { label: string; onClick: () => void };
};

type ToastKind = "ok" | "err" | "info";

type ToastItem = ToastOptions & {
  id: number;
  kind: ToastKind;
  title: string;
};

type Listener = (items: ToastItem[]) => void;

let seq = 1;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(items);
}

function push(kind: ToastKind, title: string, opts?: ToastOptions) {
  const item: ToastItem = { id: seq++, kind, title, ...opts };
  items = [...items, item].slice(-6);
  emit();
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== item.id);
    emit();
  }, 5000);
}

export const toast = {
  success(title: string, opts?: ToastOptions) {
    push("ok", title, opts);
  },
  error(title: string, opts?: ToastOptions) {
    push("err", title, opts);
  },
  message(title: string, opts?: ToastOptions) {
    push("info", title, opts);
  },
};

export function VideoToaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  if (list.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-lg border px-3 py-2 text-sm shadow-lg"
          style={{
            backgroundColor: "var(--bg-elevated)",
            borderColor:
              t.kind === "err"
                ? "#7f1d1d"
                : t.kind === "ok"
                  ? "#14532d"
                  : "var(--border-primary)",
            color: "var(--text-primary)",
          }}
        >
          <div className="font-medium">{t.title}</div>
          {t.description && (
            <div className="mt-0.5 break-all text-xs" style={{ color: "var(--text-secondary)" }}>
              {t.description}
            </div>
          )}
          {t.action && (
            <button
              type="button"
              className="mt-1 text-xs underline"
              onClick={t.action.onClick}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
