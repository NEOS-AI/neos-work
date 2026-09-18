import {
  TIMELINE_VERSION,
  type TimelineClip,
  type TimelineProject,
  type TimelineTrack,
} from "./types";

export function clipDuration(clip: TimelineClip): number {
  return clip.source_out - clip.source_in;
}

export function clipEnd(clip: TimelineClip): number {
  return clip.timeline_start + clipDuration(clip);
}

export function projectDuration(project: TimelineProject): number {
  let max = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      max = Math.max(max, clipEnd(clip));
    }
  }
  return max;
}

export function emptyProject(): TimelineProject {
  return {
    version: TIMELINE_VERSION,
    name: "Untitled",
    fps: 30,
    width: 1920,
    height: 1080,
    sample_rate: 48000,
    tracks: [
      {
        id: "V1",
        kind: "video",
        name: "V1",
        muted: false,
        clips: [],
      },
      {
        id: "A1",
        kind: "audio",
        name: "A1",
        muted: false,
        clips: [],
      },
    ],
  };
}

/** Half-open same-track ranges: [start, end). Adjacent ends are OK. */
function clipsOverlap(clips: TimelineClip[]): boolean {
  const ranges = clips
    .map((c) => ({ start: c.timeline_start, end: clipEnd(c) }))
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < ranges.length - 1; i++) {
    if (ranges[i + 1].start < ranges[i].end) return true;
  }
  return false;
}

function mapTrack(
  project: TimelineProject,
  trackId: string,
  fn: (track: TimelineTrack) => TimelineTrack,
): TimelineProject {
  let found = false;
  const tracks = project.tracks.map((t) => {
    if (t.id !== trackId) return t;
    found = true;
    return fn(t);
  });
  if (!found) return project;
  return { ...project, tracks };
}

function findClip(
  project: TimelineProject,
  clipId: string,
): { track: TimelineTrack; clip: TimelineClip; index: number } | null {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((c) => c.id === clipId);
    if (index >= 0) {
      return { track, clip: track.clips[index], index };
    }
  }
  return null;
}

function updateClip(
  project: TimelineProject,
  clipId: string,
  next: TimelineClip,
): TimelineProject {
  return {
    ...project,
    tracks: project.tracks.map((t) => {
      const i = t.clips.findIndex((c) => c.id === clipId);
      if (i < 0) return t;
      const clips = t.clips.slice();
      clips[i] = next;
      return { ...t, clips };
    }),
  };
}

export function addClip(
  project: TimelineProject,
  trackId: string,
  clip: TimelineClip,
): TimelineProject {
  return mapTrack(project, trackId, (track) => ({
    ...track,
    clips: [...track.clips, clip],
  }));
}

export function moveClip(
  project: TimelineProject,
  clipId: string,
  timelineStart: number,
): { ok: true; project: TimelineProject } | { ok: false; reason: "overlap" | "missing" } {
  const found = findClip(project, clipId);
  if (!found) return { ok: false, reason: "missing" };

  const moved: TimelineClip = { ...found.clip, timeline_start: timelineStart };
  const nextClips = found.track.clips.map((c) => (c.id === clipId ? moved : c));
  if (clipsOverlap(nextClips)) return { ok: false, reason: "overlap" };

  return {
    ok: true,
    project: updateClip(project, clipId, moved),
  };
}

export function trimClip(
  project: TimelineProject,
  clipId: string,
  edge: "in" | "out",
  sourceTime: number,
  fps: number,
): { ok: true; project: TimelineProject } | { ok: false; reason: string } {
  const found = findClip(project, clipId);
  if (!found) return { ok: false, reason: "missing" };
  if (!(fps > 0)) return { ok: false, reason: "invalid-fps" };

  const minLen = 1 / fps;
  const { clip } = found;
  let next: TimelineClip;

  if (edge === "in") {
    const delta = sourceTime - clip.source_in;
    const newIn = clip.source_in + delta;
    const newStart = clip.timeline_start + delta;
    if (newIn < 0 || newStart < 0) return { ok: false, reason: "invalid" };
    if (clip.source_out - newIn < minLen) return { ok: false, reason: "too-short" };
    if (newIn >= clip.source_out) return { ok: false, reason: "invalid" };
    next = {
      ...clip,
      source_in: newIn,
      timeline_start: newStart,
    };
  } else {
    if (sourceTime <= clip.source_in) return { ok: false, reason: "invalid" };
    if (sourceTime - clip.source_in < minLen) return { ok: false, reason: "too-short" };
    next = { ...clip, source_out: sourceTime };
  }

  const nextClips = found.track.clips.map((c) => (c.id === clipId ? next : c));
  if (clipsOverlap(nextClips)) return { ok: false, reason: "overlap" };

  return { ok: true, project: updateClip(project, clipId, next) };
}

export function splitClip(
  project: TimelineProject,
  clipId: string,
  timelineTime: number,
  newId: string,
): { ok: true; project: TimelineProject } | { ok: false; reason: string } {
  const found = findClip(project, clipId);
  if (!found) return { ok: false, reason: "missing" };

  const { clip, track } = found;
  const start = clip.timeline_start;
  const end = clipEnd(clip);

  if (timelineTime <= start || timelineTime >= end) {
    return { ok: false, reason: "at-edge" };
  }

  const offset = timelineTime - start;
  const splitSource = clip.source_in + offset;

  const left: TimelineClip = {
    ...clip,
    source_out: splitSource,
  };
  const right: TimelineClip = {
    ...clip,
    id: newId,
    source_in: splitSource,
    timeline_start: timelineTime,
    effects: [...clip.effects],
  };

  const clips = track.clips.flatMap((c) => {
    if (c.id !== clipId) return [c];
    return [left, right];
  });

  return {
    ok: true,
    project: {
      ...project,
      tracks: project.tracks.map((t) => (t.id === track.id ? { ...t, clips } : t)),
    },
  };
}

export function removeClip(project: TimelineProject, clipId: string): TimelineProject {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.filter((c) => c.id !== clipId),
    })),
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function projectHash(project: TimelineProject): string {
  return stableStringify(project);
}
