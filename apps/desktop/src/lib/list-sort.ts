/** Stable alphabetical sort by a string field (default: name). */

import { parseTimestampMs } from './format-relative-time.js';

export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
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
