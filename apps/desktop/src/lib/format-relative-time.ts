/** Human-friendly relative time for dashboard / list polish. */

/**
 * Parse ISO-8601 or SQLite `datetime('now')` strings to epoch ms.
 * SQLite returns UTC as `YYYY-MM-DD HH:MM:SS` without a zone; treat that form as UTC
 * so relative times match server-stored UTC.
 */
export function parseTimestampMs(value: string | undefined | null): number {
  if (value == null) return Number.NaN;
  const s = String(value).trim();
  if (!s) return Number.NaN;

  // SQLite UTC wall clock: "2026-07-19 12:34:56" or with fractional seconds
  const sqlite = s.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (sqlite) {
    const [, date, time, zone] = sqlite;
    const normalized = zone ? `${date}T${time}${zone}` : `${date}T${time}Z`;
    return new Date(normalized).getTime();
  }

  return new Date(s).getTime();
}

/** Absolute locale string for tooltips; falls back to raw input if unparseable. */
export function formatAbsoluteTime(value: string | undefined | null): string {
  if (value == null || value === '') return '—';
  const t = parseTimestampMs(value);
  if (!Number.isFinite(t)) return String(value);
  return new Date(t).toLocaleString();
}

export function formatRelativeTime(
  iso: string | undefined | null,
  nowMs: number = Date.now(),
): string {
  if (!iso) return '—';
  const t = parseTimestampMs(iso);
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
