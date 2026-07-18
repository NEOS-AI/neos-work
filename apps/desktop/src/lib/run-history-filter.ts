/** Pure filters for RunHistoryPanel (PLAN Task 14 polish). */

export type RunStatusFilter = 'all' | 'running' | 'completed' | 'failed' | 'cancelled';

export function filterRunsByStatus<T extends { status: string }>(
  runs: T[],
  filter: RunStatusFilter | string,
): T[] {
  if (!filter || filter === 'all') return runs;
  return runs.filter((r) => r.status === filter);
}
