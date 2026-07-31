/**
 * Async media job registry (video surface poll state machine).
 * PLAN_FOR_V0_5_0 Task 8 — video jobs.
 */

import crypto from 'node:crypto';

export type MediaJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface MediaJob {
  id: string;
  surface: 'video';
  provider: string;
  status: MediaJobStatus;
  prompt: string;
  model?: string;
  filename?: string;
  filePath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const jobs = new Map<string, MediaJob>();
const MAX_JOBS = 200;

export function clearMediaJobs(): void {
  jobs.clear();
}

export function createMediaJob(input: {
  surface: 'video';
  provider: string;
  prompt: string;
  model?: string;
}): MediaJob {
  const now = new Date().toISOString();
  const job: MediaJob = {
    id: `mjob_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    surface: input.surface,
    provider: input.provider,
    status: 'queued',
    prompt: input.prompt,
    model: input.model,
    createdAt: now,
    updatedAt: now,
  };
  // Cap map size (drop oldest finished first)
  if (jobs.size >= MAX_JOBS) {
    for (const [k, v] of jobs) {
      if (v.status === 'succeeded' || v.status === 'failed') {
        jobs.delete(k);
        if (jobs.size < MAX_JOBS) break;
      }
    }
  }
  jobs.set(job.id, job);
  return job;
}

export function getMediaJob(id: string): MediaJob | undefined {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return undefined;
  const key = id.trim();
  if (!key || key.length > 80) return undefined;
  return jobs.get(key);
}

export function updateMediaJob(
  id: string,
  patch: Partial<Pick<MediaJob, 'status' | 'filename' | 'filePath' | 'error' | 'model'>>,
): MediaJob | undefined {
  const job = getMediaJob(id);
  if (!job) return undefined;
  if (patch.status) job.status = patch.status;
  if (patch.filename !== undefined) job.filename = patch.filename;
  if (patch.filePath !== undefined) job.filePath = patch.filePath;
  if (patch.error !== undefined) job.error = patch.error;
  if (patch.model !== undefined) job.model = patch.model;
  job.updatedAt = new Date().toISOString();
  return job;
}

export function listMediaJobs(limit = 50): MediaJob[] {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return [...jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, capped);
}
