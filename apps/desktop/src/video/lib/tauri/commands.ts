/**
 * Type-safe wrappers around Tauri `invoke()` for all backend commands.
 * Dynamic import keeps `@tauri-apps/api` out of the first Vite chunk.
 */

import type {
  EnvironmentInfo,
  MuxOptions,
  TranscodeOptions,
  VideoInfo,
} from "@video/lib/types/video";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
// Probe / environment
// ---------------------------------------------------------------------------

/** Analyze a media file and return structured metadata. */
export function analyzeVideo(filePath: string): Promise<VideoInfo> {
  return invoke<VideoInfo>("analyze_video", { file_path: filePath });
}

/** Sidecar health, platform triple, and available hardware encoders. */
export function checkEnvironment(): Promise<EnvironmentInfo> {
  return invoke<EnvironmentInfo>("check_environment");
}

// ---------------------------------------------------------------------------
// Audio / subtitle extraction
// ---------------------------------------------------------------------------

export interface ExtractAudioArgs {
  inputPath: string;
  outputPath: string;
  codec: string;
  bitrate?: string;
  streamIndex?: number;
  durationSecs?: number;
  jobId?: string;
}

/** Extract an audio track from a video file. */
export function extractAudio(args: ExtractAudioArgs): Promise<void> {
  return invoke<void>("extract_audio", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    codec: args.codec,
    bitrate: args.bitrate ?? null,
    stream_index: args.streamIndex ?? null,
    duration_secs: args.durationSecs ?? null,
    job_id: args.jobId ?? null,
  });
}

export interface ExtractSubtitleArgs {
  inputPath: string;
  outputPath: string;
  streamIndex: number;
  durationSecs?: number;
  jobId?: string;
}

/** Extract a subtitle stream to srt/ass/vtt (or stream-copy). */
export function extractSubtitle(args: ExtractSubtitleArgs): Promise<void> {
  return invoke<void>("extract_subtitle", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    stream_index: args.streamIndex,
    duration_secs: args.durationSecs ?? null,
    job_id: args.jobId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Transcode / Mux
// ---------------------------------------------------------------------------

/** Transcode a video file to a different codec or container. */
export function transcodeVideo(options: TranscodeOptions): Promise<void> {
  return invoke<void>("transcode_video", {
    options: {
      ...options,
      crf: options.crf ?? null,
      subtitle_mode: options.subtitle_mode ?? null,
      subtitle_stream_index: options.subtitle_stream_index ?? null,
      subtitle_input: options.subtitle_input ?? null,
      duration_secs: options.duration_secs ?? null,
      job_id: options.job_id ?? null,
    },
  });
}

/** Mux a separate video and audio file into a single container. */
export function muxVideo(options: MuxOptions): Promise<void> {
  return invoke<void>("mux_video", {
    options: {
      ...options,
      video_streams: options.video_streams ?? null,
      audio_streams: options.audio_streams ?? null,
      subtitle_streams: options.subtitle_streams ?? null,
      subtitle_input: options.subtitle_input ?? null,
      subtitle_input_streams: options.subtitle_input_streams ?? null,
      duration_secs: options.duration_secs ?? null,
      job_id: options.job_id ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------

export interface ResizeVideoArgs {
  inputPath: string;
  outputPath: string;
  width: number;
  height: number;
  videoCodec?: string;
  crf?: number;
  durationSecs?: number;
  jobId?: string;
}

/** Resize a video to target dimensions. Pass -2 to preserve aspect ratio. */
export function resizeVideo(args: ResizeVideoArgs): Promise<void> {
  return invoke<void>("resize_video", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    width: args.width,
    height: args.height,
    video_codec: args.videoCodec ?? null,
    crf: args.crf ?? null,
    duration_secs: args.durationSecs ?? null,
    job_id: args.jobId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Job control
// ---------------------------------------------------------------------------

export interface TrimVideoArgs {
  inputPath: string;
  outputPath: string;
  startSecs?: number;
  endSecs?: number;
  streamCopy?: boolean;
  durationSecs?: number;
  jobId?: string;
}

/** Cut a time range from a video. */
export function trimVideo(args: TrimVideoArgs): Promise<void> {
  return invoke<void>("trim_video", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    start_secs: args.startSecs ?? null,
    end_secs: args.endSecs ?? null,
    stream_copy: args.streamCopy ?? true,
    duration_secs: args.durationSecs ?? null,
    job_id: args.jobId ?? null,
  });
}

/** Kill one FFmpeg job, or every running job when omitted. */
export function cancelJob(jobId?: string): Promise<void> {
  return invoke<void>("cancel_job", { job_id: jobId ?? null });
}

// ---------------------------------------------------------------------------
// File dialog helpers
// ---------------------------------------------------------------------------

const VIDEO_EXTS = ["mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v"];
const AUDIO_EXTS = ["mp3", "aac", "m4a", "flac", "wav", "opus", "ogg", "ac3"];
const SUBTITLE_EXTS = ["srt", "ass", "ssa", "vtt", "sub"];

/** Open a native file picker for video files. Returns the selected path or null. */
export async function openVideoFile(): Promise<string | null> {
  return openMediaFile("video");
}

export async function openAudioFile(): Promise<string | null> {
  return openMediaFile("audio");
}

export async function openSubtitleFile(): Promise<string | null> {
  return openMediaFile("subtitle");
}

export async function openMediaFile(
  kind: "video" | "audio" | "subtitle" | "any" = "video"
): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const filters =
    kind === "video"
      ? [{ name: "Video", extensions: VIDEO_EXTS }]
      : kind === "audio"
        ? [{ name: "Audio", extensions: AUDIO_EXTS }]
        : kind === "subtitle"
          ? [{ name: "Subtitles", extensions: SUBTITLE_EXTS }]
          : [
              { name: "Video", extensions: VIDEO_EXTS },
              { name: "Audio", extensions: AUDIO_EXTS },
              { name: "Subtitles", extensions: SUBTITLE_EXTS },
            ];
  const result = await open({
    multiple: false,
    filters,
  });
  return typeof result === "string" ? result : null;
}

/** Open a native save dialog. Returns the chosen path or null. */
export async function saveFile(
  defaultName: string,
  extensions: string[]
): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const result = await save({
    defaultPath: defaultName,
    filters: [{ name: "Output", extensions }],
  });
  return result ?? null;
}

export interface ConcatVideosArgs {
  inputs: string[];
  outputPath: string;
  streamCopy?: boolean;
  jobId?: string;
}

export function concatVideos(args: ConcatVideosArgs): Promise<void> {
  return invoke<void>("concat_videos", {
    inputs: args.inputs,
    output_path: args.outputPath,
    stream_copy: args.streamCopy ?? true,
    job_id: args.jobId ?? null,
  });
}

export interface TransformVideoArgs {
  inputPath: string;
  outputPath: string;
  rotateDegrees: number;
  hflip?: boolean;
  vflip?: boolean;
  videoCodec?: string;
  crf?: number;
  durationSecs?: number;
  jobId?: string;
}

export function transformVideo(args: TransformVideoArgs): Promise<void> {
  return invoke<void>("transform_video", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    rotate_degrees: args.rotateDegrees,
    hflip: args.hflip ?? false,
    vflip: args.vflip ?? false,
    video_codec: args.videoCodec ?? null,
    crf: args.crf ?? null,
    duration_secs: args.durationSecs ?? null,
    job_id: args.jobId ?? null,
  });
}

export interface ExportFrameArgs {
  inputPath: string;
  outputPath: string;
  atSecs: number;
  jobId?: string;
}

export function exportFrame(args: ExportFrameArgs): Promise<void> {
  return invoke<void>("export_frame", {
    input_path: args.inputPath,
    output_path: args.outputPath,
    at_secs: args.atSecs,
    job_id: args.jobId ?? null,
  });
}

/** Reveal a file in Finder / Explorer / the file manager. */
export function revealPath(path: string): Promise<void> {
  return invoke<void>("reveal_path", { path });
}

export async function openVideoFiles(): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    multiple: true,
    filters: [{ name: "Video", extensions: VIDEO_EXTS }],
  });
  if (Array.isArray(result)) return result;
  if (typeof result === "string") return [result];
  return [];
}

/** Convert a filesystem path to a Tauri asset URL (v2, cross-platform). */
export async function toAssetUrl(path: string): Promise<string> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  return convertFileSrc(path);
}
