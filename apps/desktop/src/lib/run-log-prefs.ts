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

function isRunLogFilterPref(value: unknown): value is RunLogFilterPref {
  if (typeof value !== 'string' || /[\0\r\n]/.test(value)) return false;
  const v = value.trim();
  return (
    v === 'all'
    || v === 'progress'
    || v === 'completed'
    || v === 'failed'
    || v === 'lifecycle'
  );
}

export function loadRunLogFilter(): RunLogFilterPref {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    // Control-char / unknown storage → all (align with run-history-filter)
    if (raw && isRunLogFilterPref(raw)) return raw.trim() as RunLogFilterPref;
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveRunLogFilter(filter: RunLogFilterPref): void {
  try {
    if (isRunLogFilterPref(filter)) {
      localStorage.setItem(FILTER_KEY, filter.trim());
    }
  } catch {
    // ignore quota / private mode
  }
}
