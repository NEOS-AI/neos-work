/**
 * Type-safe wrapper around the `export_gif` Tauri command.
 * Dynamically imported so Next.js static export never calls invoke at SSR time.
 */

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export interface ExportGifArgs {
  inputPath: string;
  outputPath: string;
  startSecs?: number;
  endSecs?: number;
  fps?: number;
  width?: number;
  durationSecs?: number;
  jobId?: string;
}

/** Export a time range of a video as a palette-based animated GIF. */
export function exportGif(args: ExportGifArgs): Promise<void> {
  return invoke<void>("export_gif", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    start_secs: args.startSecs ?? null,
    end_secs: args.endSecs ?? null,
    fps: args.fps ?? null,
    width: args.width ?? null,
    duration_secs: args.durationSecs ?? null,
    job_id: args.jobId ?? null,
  });
}
