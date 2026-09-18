async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export interface ApplyWatermarkArgs {
  inputPath: string;
  outputPath: string;
  position: string;
  imagePath?: string;
  text?: string;
  fontPath?: string;
  fontSize?: number;
  videoCodec?: string;
  crf?: number;
  durationSecs?: number;
  jobId?: string;
}

export function applyWatermark(args: ApplyWatermarkArgs): Promise<void> {
  return invoke<void>("apply_watermark", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    position: args.position,
    image_path: args.imagePath ?? null,
    text: args.text ?? null,
    font_path: args.fontPath ?? null,
    font_size: args.fontSize ?? null,
    video_codec: args.videoCodec ?? null,
    crf: args.crf ?? null,
    duration_secs: args.durationSecs ?? null,
    job_id: args.jobId ?? null,
  });
}
