/** Pick the N most recently updated workflows for dashboard shortcuts. */

import { parseTimestampMs } from './format-relative-time.js';

export interface RecentWorkflowLike {
  id: string;
  name: string;
  domain: string;
  updatedAt: string;
  nodes?: unknown[];
  edges?: unknown[];
}

export interface RecentByDateLike {
  id: string;
  updatedAt: string;
}

function timeMs(value: string | undefined): number {
  const t = parseTimestampMs(value);
  return Number.isFinite(t) ? t : 0;
}

/** Generic newest-first picker by ISO `updatedAt` (or any date string). */
export function pickRecentByDate<T extends RecentByDateLike>(
  items: T[],
  limit = 5,
): T[] {
  const n = Math.max(0, Math.floor(limit));
  if (n === 0 || items.length === 0) return [];
  return [...items]
    .sort((a, b) => timeMs(b.updatedAt) - timeMs(a.updatedAt))
    .slice(0, n);
}

export function pickRecentWorkflows<T extends RecentWorkflowLike>(
  workflows: T[],
  limit = 5,
): T[] {
  return pickRecentByDate(workflows, limit);
}

/** Recent automation routines for dashboard (PLAN Task 2 polish). */
export function pickRecentRoutines<T extends RecentByDateLike & { name: string; enabled: boolean }>(
  routines: T[],
  limit = 5,
): T[] {
  return pickRecentByDate(routines, limit);
}

export interface RecentDeploymentLike {
  id: string;
  createdAt: string;
  status: string;
  provider: string;
  projectName?: string;
  url?: string;
  workflowId?: string;
}

/**
 * Recent deployments for dashboard (PLAN Task 8 polish).
 * Sorts by `createdAt` (deploy time) rather than updatedAt.
 */
export function pickRecentDeployments<T extends RecentDeploymentLike>(
  deployments: T[],
  limit = 5,
): T[] {
  const n = Math.max(0, Math.floor(limit));
  if (n === 0 || deployments.length === 0) return [];
  return [...deployments]
    .sort((a, b) => timeMs(b.createdAt) - timeMs(a.createdAt))
    .slice(0, n);
}
