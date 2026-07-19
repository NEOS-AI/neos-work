/** Pure filters + status chip prefs for RunHistoryPanel (PLAN Task 14 polish). */

export type RunStatusFilter = 'all' | 'running' | 'completed' | 'failed' | 'cancelled';

export const RUN_STATUS_FILTERS: readonly RunStatusFilter[] = [
  'all',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

const STATUS_KEY = 'neos-run-history-status';

export function isRunStatusFilter(value: string): value is RunStatusFilter {
  return (RUN_STATUS_FILTERS as readonly string[]).includes(value);
}

export function loadRunStatusFilter(): RunStatusFilter {
  try {
    const v = localStorage.getItem(STATUS_KEY);
    if (v && isRunStatusFilter(v)) return v;
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveRunStatusFilter(filter: RunStatusFilter): void {
  try {
    if (isRunStatusFilter(filter)) {
      localStorage.setItem(STATUS_KEY, filter);
    }
  } catch {
    // ignore quota / private mode
  }
}

export function filterRunsByStatus<T extends { status: string }>(
  runs: T[],
  filter: RunStatusFilter | string,
): T[] {
  if (!filter || filter === 'all') return runs;
  return runs.filter((r) => r.status === filter);
}
