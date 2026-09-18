export const TIMELINE_VERSION = 1 as const;

export type TrackKind = "video" | "audio";

export interface ClipEffect {
  type: string;
  [key: string]: unknown;
}

export interface TimelineClip {
  id: string;
  source_path: string;
  source_in: number;
  source_out: number;
  timeline_start: number;
  effects: ClipEffect[];
}

export interface TimelineTrack {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  clips: TimelineClip[];
}

export interface TimelineProject {
  version: number;
  name: string;
  fps: number;
  width: number;
  height: number;
  sample_rate: number;
  tracks: TimelineTrack[];
}

export interface RenderProfile {
  width: number;
  height: number;
  fps: number;
  video_codec: string;
  audio_codec: string;
  crf: number | null;
  video_bitrate: string | null;
  preset: string | null;
  audio_bitrate: string | null;
}

export interface TimelineValidation {
  duration_secs: number;
  warnings: string[];
}
