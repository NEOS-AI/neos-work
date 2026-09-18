import { useEffect, useRef, useState } from "react";
import type { ProgressPayload } from "@video/lib/types/video";

export interface ProgressState {
  percent: number;
  message: string;
  isRunning: boolean;
}

/**
 * Subscribe to the "ffmpeg-progress" Tauri event emitted by the Rust backend.
 * When `jobId` is set, events from other concurrent jobs are ignored.
 */
export function useProgress() {
  const [state, setState] = useState<ProgressState>({
    percent: 0,
    message: "",
    isRunning: false,
  });

  const unlistenRef = useRef<(() => void) | null>(null);
  const jobIdRef = useRef<string | null>(null);

  const start = async (jobId?: string) => {
    setState({ percent: 0, message: "", isRunning: true });
    jobIdRef.current = jobId ?? null;

    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<ProgressPayload>("ffmpeg-progress", (event) => {
      const incoming = event.payload.job_id;
      const expected = jobIdRef.current;
      if (expected && incoming && incoming !== expected) {
        return;
      }
      setState({
        percent: event.payload.percent,
        message: event.payload.message,
        isRunning: event.payload.percent < 100 || event.payload.message.includes("retrying"),
      });
    });
    unlistenRef.current = unlisten;
  };

  const stop = () => {
    unlistenRef.current?.();
    unlistenRef.current = null;
    jobIdRef.current = null;
    setState((prev) => ({ ...prev, isRunning: false }));
  };

  const hint = (percent: number, message: string) => {
    setState((prev) => ({
      ...prev,
      percent,
      message,
      isRunning: true,
    }));
  };

  const reset = () => {
    stop();
    setState({ percent: 0, message: "", isRunning: false });
  };

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  return { ...state, start, stop, reset, hint };
}
