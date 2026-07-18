/** Persist Media page kind filter (PLAN Task 7 polish). */

const KIND_KEY = 'neos-media-kind';

export type MediaKindFilter = 'all' | 'image' | 'audio' | 'other';

export function loadMediaKindFilter(): MediaKindFilter {
  try {
    const v = localStorage.getItem(KIND_KEY);
    if (v === 'image' || v === 'audio' || v === 'other' || v === 'all') return v;
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveMediaKindFilter(kind: MediaKindFilter): void {
  try {
    if (kind === 'all' || kind === 'image' || kind === 'audio' || kind === 'other') {
      localStorage.setItem(KIND_KEY, kind);
    }
  } catch {
    // ignore quota / private mode
  }
}
