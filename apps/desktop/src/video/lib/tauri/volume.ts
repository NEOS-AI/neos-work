async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export interface AdjustVolumeArgs {
  inputPath: string;
  outputPath: string;
  normalize?: boolean;
  gainDb?: number;
  durationSecs?: number;
  jobId?: string;
}

export function adjustVolume(args: AdjustVolumeArgs): Promise<void> {
  return invoke<void>("adjust_volume", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    normalize: args.normalize ?? false,
    gain_db: args.gainDb ?? 0,
    duration_secs: args.durationSecs ?? null,
    job_id: args.jobId ?? null,
  });
}
