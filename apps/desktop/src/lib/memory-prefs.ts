/** Persist Memory page type chip (PLAN residual UX polish). */

export type MemoryTypeFilter = 'all' | 'user' | 'session' | 'skill' | 'reference';

export const MEMORY_TYPE_FILTERS: readonly MemoryTypeFilter[] = [
  'all',
  'user',
  'session',
  'skill',
  'reference',
] as const;

const TYPE_KEY = 'neos-memory-type';

const ALLOWED = new Set<string>(['all', 'user', 'session', 'skill', 'reference']);

function parseType(raw: unknown): MemoryTypeFilter | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return ALLOWED.has(v) ? (v as MemoryTypeFilter) : null;
}

export function loadMemoryTypeFilter(): MemoryTypeFilter {
  try {
    return parseType(localStorage.getItem(TYPE_KEY)) ?? 'all';
  } catch {
    return 'all';
  }
}

export function saveMemoryTypeFilter(type: MemoryTypeFilter): void {
  try {
    const parsed = parseType(type);
    if (parsed) localStorage.setItem(TYPE_KEY, parsed);
  } catch {
    // ignore quota / private mode
  }
}
