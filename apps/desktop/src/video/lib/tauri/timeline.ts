/**
 * Type-safe wrappers around timeline Tauri commands.
 * Dynamic import avoids SSR issues (Next.js static export / Tauri WebView only).
 */

import type {
  RenderProfile,
  TimelineProject,
  TimelineValidation,
} from "@video/lib/timeline/types";

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export function validateTimeline(project: TimelineProject): Promise<TimelineValidation> {
  return invoke<TimelineValidation>("validate_timeline", { project });
}

export function exportTimeline(opts: {
  project: TimelineProject;
  outputPath: string;
  profile?: RenderProfile | null;
  jobId?: string;
}): Promise<void> {
  return invoke<void>("export_timeline", {
    options: {
      project: opts.project,
      output_path: opts.outputPath,
      profile: opts.profile ?? null,
      job_id: opts.jobId ?? null,
    },
  });
}

export function renderTimelineProxy(opts: {
  project: TimelineProject;
  outputPath: string;
  profile?: RenderProfile | null;
  jobId?: string;
}): Promise<void> {
  return invoke<void>("render_timeline_proxy", {
    options: {
      project: opts.project,
      output_path: opts.outputPath,
      profile: opts.profile ?? null,
      job_id: opts.jobId ?? null,
    },
  });
}

export async function openJsonFile(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return typeof result === "string" ? result : null;
}

export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke<void>("write_text_file", { path, contents });
}

export function removeFile(path: string): Promise<void> {
  return invoke<void>("remove_file", { path });
}
