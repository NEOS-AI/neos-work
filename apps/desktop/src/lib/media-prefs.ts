/** Persist Media page kind filter (PLAN Task 7 polish). */

const KIND_KEY = 'neos-media-kind';

export type MediaKindFilter = 'all' | 'image' | 'audio' | 'other';

const ALLOWED = new Set<string>(['all', 'image', 'audio', 'other']);

function parseKind(raw: unknown): MediaKindFilter | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return ALLOWED.has(v) ? (v as MediaKindFilter) : null;
}

export function loadMediaKindFilter(): MediaKindFilter {
  try {
    return parseKind(localStorage.getItem(KIND_KEY)) ?? 'all';
  } catch {
    return 'all';
  }
}

export function saveMediaKindFilter(kind: MediaKindFilter): void {
  try {
    const parsed = parseKind(kind);
    if (parsed) localStorage.setItem(KIND_KEY, parsed);
  } catch {
    // ignore quota / private mode
  }
}
