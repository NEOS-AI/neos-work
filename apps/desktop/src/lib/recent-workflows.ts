/** Pick the N most recently updated workflows for dashboard shortcuts. */

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

/** Generic newest-first picker by ISO `updatedAt` (or any date string). */
export function pickRecentByDate<T extends RecentByDateLike>(
  items: T[],
  limit = 5,
): T[] {
  const n = Math.max(0, Math.floor(limit));
  if (n === 0 || items.length === 0) return [];
  return [...items]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
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
