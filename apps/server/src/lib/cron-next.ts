/**
 * Lightweight next-run estimator for 5-field cron expressions (plan Task 2).
 * Supports common forms used by Routines UI (minute/hour/dom/month/dow).
 * Not a full cron engine — best-effort within a limited search window.
 */

const FIELD_RE = /^(\*|\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)(\/\d+)?$/;

function parseField(field: string, min: number, max: number): number[] | null {
  const m = field.trim().match(FIELD_RE);
  if (!m) return null;
  const step = m[2] ? parseInt(m[2].slice(1), 10) : 1;
  if (!Number.isFinite(step) || step < 1) return null;

  const values = new Set<number>();
  const base = m[1]!;
  if (base === '*') {
    for (let i = min; i <= max; i += step) values.add(i);
    return [...values].sort((a, b) => a - b);
  }

  for (const part of base.split(',')) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a! < min || b! > max || a! > b!) return null;
      for (let i = a!; i <= b!; i += step) values.add(i);
    } else {
      const n = Number(part);
      if (!Number.isFinite(n) || n < min || n > max) return null;
      if (step === 1 || (n - min) % step === 0) values.add(n);
    }
  }
  return [...values].sort((a, b) => a - b);
}

/**
 * Estimate the next Date after `from` matching a 5-field cron in a given IANA timezone.
 * Returns null if the expression is invalid or no match within `horizonDays`.
 */
export function estimateNextCronRun(
  expression: string,
  options?: { from?: Date; timezone?: string; horizonDays?: number },
): Date | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const minutes = parseField(parts[0]!, 0, 59);
  const hours = parseField(parts[1]!, 0, 23);
  const daysOfMonth = parseField(parts[2]!, 1, 31);
  const months = parseField(parts[3]!, 1, 12);
  const daysOfWeek = parseField(parts[4]!, 0, 6);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;

  const from = options?.from ?? new Date();
  const tz = options?.timezone?.trim() || 'UTC';
  const horizonDays = options?.horizonDays ?? 366;

  // Invalid IANA timezone → null (callers treat as unknown next run)
  if (!isValidTimeZone(tz)) return null;

  // Walk minute-by-minute in the target timezone wall clock via iterative UTC + formatter
  // Start from next whole minute after `from`
  let cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor = new Date(cursor.getTime() + 60_000);

  const maxSteps = horizonDays * 24 * 60;
  for (let i = 0; i < maxSteps; i++) {
    const partsInTz = getZonedParts(cursor, tz);
    if (!partsInTz) return null;
    if (
      months.includes(partsInTz.month)
      && daysOfMonth.includes(partsInTz.day)
      && daysOfWeek.includes(partsInTz.weekday)
      && hours.includes(partsInTz.hour)
      && minutes.includes(partsInTz.minute)
    ) {
      return cursor;
    }
    cursor = new Date(cursor.getTime() + 60_000);
  }
  return null;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

function getZonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} | null {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    const map = Object.fromEntries(
      dtf.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
    );
    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: Number(map.hour),
      minute: Number(map.minute),
      weekday: weekdayMap[map.weekday ?? 'Sun'] ?? 0,
    };
  } catch {
    return null;
  }
}
