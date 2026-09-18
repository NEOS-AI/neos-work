import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "neos-video:selected-file";

function readStored(): string {
  if (typeof window === "undefined") return "";
  const fromQuery = new URLSearchParams(window.location.search).get("file");
  if (fromQuery) {
    try {
      sessionStorage.setItem(STORAGE_KEY, fromQuery);
    } catch {
      // ignore quota / private mode
    }
    return fromQuery;
  }
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberFile(path: string) {
  if (typeof window === "undefined" || !path) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    // ignore
  }
}

/** Persist the last chosen media path across pages (query `?file=` wins). */
export function useRememberedFile() {
  const [path, setPath] = useState("");

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setPath(readStored());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((next: string) => {
    setPath(next);
    rememberFile(next);
  }, []);

  return [path, update] as const;
}

export function hrefWithFile(href: string, file: string | null | undefined): string {
  if (!file) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}file=${encodeURIComponent(file)}`;
}
