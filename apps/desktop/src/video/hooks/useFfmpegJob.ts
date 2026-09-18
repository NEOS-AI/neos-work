import { useRef, useState } from "react";
import { useProgress } from "./useProgress";
import { cancelJob } from "@video/lib/tauri/commands";
import { isCancelledError } from "@video/lib/types/video";
import { recordJobEnd, recordJobStart } from "@video/lib/jobHistory";
import type { JobReplay } from "@video/lib/jobReplay";

export type JobResult =
  | { ok: true }
  | { ok: false; cancelled: boolean; error: string };

function newJobId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Wraps useProgress with run/cancel helpers. Each run is also appended to
 * the in-app job history (localStorage) under `label`.
 */
export function useFfmpegJob(label = "FFmpeg") {
  const progress = useProgress();
  const [isRunning, setIsRunning] = useState(false);
  const jobIdRef = useRef<string | null>(null);

  const runJob = async (
    work: (jobId: string) => Promise<void>,
    opts?: { outputPath?: string; replay?: JobReplay; label?: string }
  ): Promise<JobResult> => {
    const jobId = newJobId();
    jobIdRef.current = jobId;
    setIsRunning(true);
    recordJobStart(jobId, opts?.label ?? label, opts?.replay);
    await progress.start(jobId);
    try {
      await work(jobId);
      recordJobEnd(jobId, "ok", opts?.outputPath);
      return { ok: true };
    } catch (err) {
      const cancelled = isCancelledError(err);
      recordJobEnd(
        jobId,
        cancelled ? "cancelled" : "error",
        opts?.outputPath,
        cancelled ? undefined : String(err)
      );
      return {
        ok: false,
        cancelled,
        error: String(err),
      };
    } finally {
      setIsRunning(false);
      jobIdRef.current = null;
      progress.stop();
    }
  };

  const cancel = async () => {
    try {
      await cancelJob(jobIdRef.current ?? undefined);
    } catch {
      // Nothing to cancel is not a user-facing error.
    }
  };

  return { ...progress, isRunning, runJob, cancel };
}
