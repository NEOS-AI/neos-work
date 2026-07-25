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
  if (typeof value !== 'string') return false;
  // Control-char stored values never match a known chip (check before trim)
  if (/[\0\r\n]/.test(value)) return false;
  const v = value.trim();
  return (RUN_STATUS_FILTERS as readonly string[]).includes(v);
}

export function loadRunStatusFilter(): RunStatusFilter {
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    // Control-char / non-chip storage → all
    if (raw && isRunStatusFilter(raw)) {
      // isRunStatusFilter already rejects control; trim for return
      return raw.trim() as RunStatusFilter;
    }
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveRunStatusFilter(filter: RunStatusFilter): void {
  try {
    if (isRunStatusFilter(filter)) {
      localStorage.setItem(STATUS_KEY, filter.trim());
    }
  } catch {
    // ignore quota / private mode
  }
}

/** Normalize run status for filter compare (control → empty = no match). */
export function normalizeRunStatus(status: unknown): string {
  if (typeof status !== 'string' || /[\0\r\n]/.test(status)) return '';
  return status.trim().toLowerCase();
}

export function filterRunsByStatus<T extends { status: string }>(
  runs: T[],
  filter: RunStatusFilter | string,
): T[] {
  if (typeof filter !== 'string' || /[\0\r\n]/.test(filter)) return runs;
  const f = filter.trim().toLowerCase();
  if (!f || f === 'all') return runs;
  // Compare normalized (lowercased, control-free) status to chip filter
  return runs.filter((r) => normalizeRunStatus(r.status) === f);
}
