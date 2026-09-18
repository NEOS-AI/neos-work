import type { JobReplay } from "@video/lib/jobReplay";

export type { JobReplay };

export type JobStatus = "running" | "ok" | "cancelled" | "error";

export interface JobRecord {
  id: string;
  label: string;
  outputPath?: string;
  status: JobStatus;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  replay?: JobReplay;
}

const STORAGE_KEY = "neos-video:job-history";
const EVENT = "neos-video:job-history-changed";
const MAX = 50;

function readAll(): JobRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as JobRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(rows: JobRecord[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // quota / private mode
  }
}

export function listJobs(): JobRecord[] {
  return readAll();
}

export function recordJobStart(id: string, label: string, replay?: JobReplay) {
  const next: JobRecord = {
    id,
    label,
    status: "running",
    startedAt: Date.now(),
    replay,
  };
  writeAll([next, ...readAll().filter((j) => j.id !== id)]);
}

export function recordJobEnd(
  id: string,
  status: Exclude<JobStatus, "running">,
  outputPath?: string,
  error?: string
) {
  writeAll(
    readAll().map((j) =>
      j.id === id
        ? {
            ...j,
            status,
            outputPath: outputPath || j.outputPath,
            error,
            finishedAt: Date.now(),
          }
        : j
    )
  );
}

export function clearJobs() {
  writeAll([]);
}

export function subscribeJobs(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
