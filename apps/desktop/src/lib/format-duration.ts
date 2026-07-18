import { parseTimestampMs } from './format-relative-time.js';

/** Format a millisecond duration (node run results). */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Format a time range as a short human duration (run history, etc.). */
export function formatDuration(startedAt: string, completedAt?: string): string {
  if (!completedAt) return '—';
  const start = parseTimestampMs(startedAt);
  const end = parseTimestampMs(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  return formatDurationMs(end - start);
}

/** Serialize node output for clipboard / export. */
export function serializeNodeOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}
