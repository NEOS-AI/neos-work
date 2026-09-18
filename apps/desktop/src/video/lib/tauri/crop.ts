async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export interface CropVideoArgs {
  inputPath: string;
  outputPath: string;
  width: number;
  height: number;
  x: number;
  y: number;
  videoCodec?: string;
  crf?: number;
  durationSecs?: number;
  jobId?: string;
}

/** Crop a rectangle from a video and re-encode. */
export function cropVideo(args: CropVideoArgs): Promise<void> {
  return invoke<void>("crop_video", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    width: args.width,
    height: args.height,
    x: args.x,
    y: args.y,
    video_codec: args.videoCodec ?? null,
    crf: args.crf ?? null,
    duration_secs: args.durationSecs ?? null,
    job_id: args.jobId ?? null,
  });
}
