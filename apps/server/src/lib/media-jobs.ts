/**
 * Async media job registry (video surface poll state machine).
 * PLAN_FOR_V0_5_0 Task 8 — video jobs.
 */

import crypto from 'node:crypto';

export type MediaJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

const JOB_STATUSES = new Set<MediaJobStatus>(['queued', 'running', 'succeeded', 'failed']);
const PROMPT_MAX = 4_000;
const PROVIDER_MAX = 64;
const MODEL_MAX = 120;
const ERROR_MAX = 500;

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

function sanitizeProvider(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'unknown';
  const t = raw.trim().toLowerCase().slice(0, PROVIDER_MAX);
  return t || 'unknown';
}

function sanitizePrompt(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim().slice(0, PROMPT_MAX);
}

function sanitizeModel(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const t = raw.trim().slice(0, MODEL_MAX);
  return t || undefined;
}

function sanitizeError(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const t = raw.replace(/[\0\r\n]+/g, ' ').trim().slice(0, ERROR_MAX);
  return t || undefined;
}

/** Drop finished jobs first, then oldest by createdAt, until size < MAX_JOBS. */
function enforceJobCap(): void {
  if (jobs.size < MAX_JOBS) return;
  for (const [k, v] of jobs) {
    if (v.status === 'succeeded' || v.status === 'failed') {
      jobs.delete(k);
      if (jobs.size < MAX_JOBS) return;
    }
  }
  // Still full of active jobs — drop oldest entries regardless of status
  const ordered = [...jobs.entries()].sort((a, b) =>
    a[1].createdAt.localeCompare(b[1].createdAt),
  );
  for (const [k] of ordered) {
    if (jobs.size < MAX_JOBS) break;
    jobs.delete(k);
  }
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
    surface: 'video',
    provider: sanitizeProvider(input.provider),
    status: 'queued',
    prompt: sanitizePrompt(input.prompt),
    model: sanitizeModel(input.model),
    createdAt: now,
    updatedAt: now,
  };
  enforceJobCap();
  jobs.set(job.id, job);
  // Hard cap after insert (in case race / map already at limit)
  if (jobs.size > MAX_JOBS) enforceJobCap();
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
  if (patch.status && JOB_STATUSES.has(patch.status)) {
    job.status = patch.status;
  }
  if (patch.filename !== undefined) {
    job.filename =
      typeof patch.filename === 'string' && !/[\0\r\n]/.test(patch.filename)
        ? patch.filename.trim().slice(0, 200) || undefined
        : undefined;
  }
  if (patch.filePath !== undefined) {
    job.filePath =
      typeof patch.filePath === 'string' && !/[\0\r\n]/.test(patch.filePath)
        ? patch.filePath.trim().slice(0, 1_024) || undefined
        : undefined;
  }
  if (patch.error !== undefined) {
    job.error = sanitizeError(patch.error);
  }
  if (patch.model !== undefined) {
    job.model = sanitizeModel(patch.model);
  }
  job.updatedAt = new Date().toISOString();
  return job;
}

export function listMediaJobs(limit = 50): MediaJob[] {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return [...jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, capped);
}
