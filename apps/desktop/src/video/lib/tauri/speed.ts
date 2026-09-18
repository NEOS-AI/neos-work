/**
 * Type-safe wrapper around the `change_speed` Tauri command.
 * Dynamically imported to avoid SSR issues (Next.js static export).
 */

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export interface ChangeSpeedArgs {
  inputPath: string;
  outputPath: string;
  rate: number;
  hasAudio?: boolean;
  videoCodec?: string;
  crf?: number;
  durationSecs?: number;
  jobId?: string;
}

/** Re-encode a video so it plays at `rate` times the original speed. */
export function changeSpeed(args: ChangeSpeedArgs): Promise<void> {
  return invoke<void>("change_speed", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    rate: args.rate,
    has_audio: args.hasAudio ?? null,
    video_codec: args.videoCodec ?? null,
    crf: args.crf ?? null,
    duration_secs: args.durationSecs ?? null,
    job_id: args.jobId ?? null,
  });
}
