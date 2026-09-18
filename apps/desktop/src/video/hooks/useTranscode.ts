import { useState } from "react";
import { useProgress } from "./useProgress";
import type { TranscodeOptions } from "@video/lib/types/video";
import { isCancelledError } from "@video/lib/types/video";

export function useTranscode() {
  const [error, setError] = useState<string | null>(null);
  const progress = useProgress();

  const transcode = async (options: TranscodeOptions) => {
    setError(null);
    await progress.start();
    try {
      const { transcodeVideo } = await import("@video/lib/tauri/commands");
      await transcodeVideo(options);
    } catch (err) {
      if (!isCancelledError(err)) {
        setError(String(err));
      }
    } finally {
      progress.stop();
    }
  };

  const reset = () => {
    setError(null);
    progress.reset();
  };

  return { ...progress, error, transcode, reset };
}
