// Shared TypeScript types mirroring the Rust models in src-tauri/src/models/

export interface FormatInfo {
  filename: string;
  format_name: string;
  format_long_name: string;
  /** Duration in seconds */
  duration: number | null;
  /** Total bit rate in bps */
  bit_rate: number | null;
  /** File size in bytes */
  size: number | null;
}

export interface StreamInfo {
  index: number;
  codec_type: string;
  codec_name: string;
  codec_long_name: string | null;
  // Video
  width: number | null;
  height: number | null;
  /** Clockwise degrees from rotate tag / displaymatrix. */
  rotation: number | null;
  r_frame_rate: string | null;
  avg_frame_rate: string | null;
  pix_fmt: string | null;
  // Audio
  sample_rate: string | null;
  channels: number | null;
  channel_layout: string | null;
  bit_rate: string | null;
  duration: string | null;
  language: string | null;
  title: string | null;
}

export interface VideoInfo {
  format: FormatInfo;
  streams: StreamInfo[];
}

/** Payload emitted by the Rust backend on "ffmpeg-progress" events */
export interface ProgressPayload {
  job_id?: string;
  percent: number;
  message: string;
}

export interface TranscodeOptions {
  input_path: string;
  output_path: string;
  video_codec: string;
  audio_codec: string;
  crf?: number;
  /** `"copy"` remuxes; `"burn"` hard-burns; omit or `"none"` to drop. */
  subtitle_mode?: "copy" | "none" | "burn";
  subtitle_stream_index?: number;
  /** External subtitle file to burn instead of an embedded stream. */
  subtitle_input?: string | null;
  duration_secs?: number;
  job_id?: string;
}

export interface MuxOptions {
  video_input: string;
  audio_input: string;
  output_path: string;
  video_streams?: number[];
  audio_streams?: number[];
  subtitle_streams?: number[];
  subtitle_input?: string | null;
  subtitle_input_streams?: number[];
  duration_secs?: number;
  job_id?: string;
}

export interface EnvironmentInfo {
  os: string;
  arch: string;
  target_triple: string;
  ffmpeg_ok: boolean;
  ffprobe_ok: boolean;
  ffmpeg_version: string | null;
  ffprobe_version: string | null;
  ffmpeg_source: string | null;
  ffprobe_source: string | null;
  ffmpeg_sidecar: string;
  ffprobe_sidecar: string;
  ytdlp_ok: boolean;
  ytdlp_version: string | null;
  ytdlp_source: string | null;
  ytdlp_sidecar: string;
  hw_encoders: string[];
  hw_accels: string[];
}

/** Parse a fractional frame-rate string like "30000/1001" → fps number */
/** True when 90°/270° metadata swaps coded width and height on screen. */
export function rotationSwapsAxes(degrees: number | null | undefined): boolean {
  if (degrees == null || !Number.isFinite(degrees)) return false;
  const q = ((Math.round(degrees / 90) % 4) + 4) % 4;
  return q === 1 || q === 3;
}

export function displaySize(
  width: number | null | undefined,
  height: number | null | undefined,
  rotation?: number | null
): { width: number; height: number } | null {
  if (!width || !height) return null;
  if (rotationSwapsAxes(rotation)) return { width: height, height: width };
  return { width, height };
}

export function parseFps(raw: string | null): number | null {
  if (!raw) return null;
  const [num, den] = raw.split("/").map(Number);
  if (!den || den === 0) return null;
  return num / den;
}

/** Format bytes to a human-readable string */
export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Format seconds to HH:MM:SS */
export function formatDuration(secs: number | null): string {
  if (secs == null) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

export function isCancelledError(err: unknown): boolean {
  return /cancelled/i.test(String(err));
}

export function streamLabel(stream: StreamInfo): string {
  const bits = [`#${stream.index}`, stream.codec_type, stream.codec_name];
  if (stream.language) bits.push(stream.language);
  if (stream.title) bits.push(`“${stream.title}”`);
  if (stream.width && stream.height) bits.push(`${stream.width}×${stream.height}`);
  if (stream.channels) bits.push(`${stream.channels}ch`);
  return bits.join(" · ");
}
