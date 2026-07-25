/** Stable alphabetical sort by a string field (default: name). */

import { parseTimestampMs } from './format-relative-time.js';

/** Sort key for names: drop null bytes; collapse CR/LF so sort order is stable. */
function nameSortKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Control-char collapse before trim (leading \n must not create empty-looking order quirks alone)
  let s = raw.replace(/\0/g, '').replace(/[\r\n]+/g, ' ').trim().toLowerCase();
  // Cap key length for pathological names
  if (s.length > 500) s = s.slice(0, 500);
  return s;
}

export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => nameSortKey(a.name).localeCompare(nameSortKey(b.name)));
}

/** Sort by ISO/date string field descending (newest first). */
export function sortByDateDesc<T>(
  items: T[],
  getDate: (item: T) => string | undefined,
): T[] {
  return [...items].sort((a, b) => {
    const ta = parseTimestampMs(getDate(a));
    const tb = parseTimestampMs(getDate(b));
    const sa = Number.isFinite(ta) ? ta : 0;
    const sb = Number.isFinite(tb) ? tb : 0;
    return sb - sa;
  });
}
