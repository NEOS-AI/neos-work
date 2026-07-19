/** Persist RunLogPanel event category chips (PLAN Task 14 polish). */

export type RunLogFilterPref = 'all' | 'progress' | 'completed' | 'failed' | 'lifecycle';

export const RUN_LOG_FILTERS: readonly RunLogFilterPref[] = [
  'all',
  'progress',
  'completed',
  'failed',
  'lifecycle',
] as const;

const FILTER_KEY = 'neos-run-log-filter';

export function loadRunLogFilter(): RunLogFilterPref {
  try {
    const v = localStorage.getItem(FILTER_KEY);
    if (
      v === 'all' ||
      v === 'progress' ||
      v === 'completed' ||
      v === 'failed' ||
      v === 'lifecycle'
    ) {
      return v;
    }
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveRunLogFilter(filter: RunLogFilterPref): void {
  try {
    if (
      filter === 'all' ||
      filter === 'progress' ||
      filter === 'completed' ||
      filter === 'failed' ||
      filter === 'lifecycle'
    ) {
      localStorage.setItem(FILTER_KEY, filter);
    }
  } catch {
    // ignore quota / private mode
  }
}
