/** Stable alphabetical sort by a string field (default: name). */
export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

/** Sort by ISO/date string field descending (newest first). */
export function sortByDateDesc<T>(
  items: T[],
  getDate: (item: T) => string | undefined,
): T[] {
  return [...items].sort((a, b) => {
    const ta = new Date(getDate(a) ?? 0).getTime();
    const tb = new Date(getDate(b) ?? 0).getTime();
    return tb - ta;
  });
}
