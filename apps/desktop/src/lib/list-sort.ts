/** Stable alphabetical sort by a string field (default: name). */

import { parseTimestampMs } from './format-relative-time.js';

/** Sort key for names: drop null bytes; collapse CR/LF so sort order is stable. */
function nameSortKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw;
  if (/\0/.test(s)) s = s.replace(/\0/g, '');
  if (/[\r\n]/.test(s)) s = s.replace(/[\r\n]+/g, ' ');
  return s.trim().toLowerCase();
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
