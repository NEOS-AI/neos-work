async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export interface FadeVideoArgs {
  inputPath: string;
  outputPath: string;
  fadeInSecs?: number;
  fadeOutSecs?: number;
  includeAudio?: boolean;
  videoCodec?: string;
  crf?: number;
  durationSecs?: number;
  jobId?: string;
}

export function fadeVideo(args: FadeVideoArgs): Promise<void> {
  return invoke<void>("fade_video", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    fade_in_secs: args.fadeInSecs ?? 0,
    fade_out_secs: args.fadeOutSecs ?? 0,
    include_audio: args.includeAudio ?? true,
    video_codec: args.videoCodec ?? null,
    crf: args.crf ?? null,
    duration_secs: args.durationSecs ?? null,
    job_id: args.jobId ?? null,
  });
}
