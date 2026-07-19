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

export function loadMemoryTypeFilter(): MemoryTypeFilter {
  try {
    const v = localStorage.getItem(TYPE_KEY);
    if (
      v === 'all' ||
      v === 'user' ||
      v === 'session' ||
      v === 'skill' ||
      v === 'reference'
    ) {
      return v;
    }
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveMemoryTypeFilter(type: MemoryTypeFilter): void {
  try {
    if (
      type === 'all' ||
      type === 'user' ||
      type === 'session' ||
      type === 'skill' ||
      type === 'reference'
    ) {
      localStorage.setItem(TYPE_KEY, type);
    }
  } catch {
    // ignore quota / private mode
  }
}
