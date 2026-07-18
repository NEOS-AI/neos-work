/** Human-friendly relative time for dashboard / list polish. */

export function formatRelativeTime(
  iso: string | undefined | null,
  nowMs: number = Date.now(),
): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = nowMs - t;
  const abs = Math.abs(diff);
  const future = diff < 0;

  const sec = Math.round(abs / 1000);
  if (sec < 45) return future ? 'in a moment' : 'just now';

  const min = Math.round(sec / 60);
  if (min < 60) return future ? `in ${min}m` : `${min}m ago`;

  const hr = Math.round(min / 60);
  if (hr < 48) return future ? `in ${hr}h` : `${hr}h ago`;

  const day = Math.round(hr / 24);
  if (day < 30) return future ? `in ${day}d` : `${day}d ago`;

  const month = Math.round(day / 30);
  if (month < 18) return future ? `in ${month}mo` : `${month}mo ago`;

  const year = Math.round(day / 365);
  return future ? `in ${year}y` : `${year}y ago`;
}
