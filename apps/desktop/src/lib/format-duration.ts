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

/**
 * Scrub control characters from run UI / clipboard text.
 * - Null bytes always stripped
 * - When `collapseLines` is true, CR/LF become spaces (error / label lines)
 * - Multi-line stream/output keeps newlines unless collapseLines
 */
export function scrubDisplayText(
  raw: unknown,
  options?: { collapseLines?: boolean; maxChars?: number },
): string {
  let s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  // Always drop null bytes (DOM/clipboard injection defense)
  if (/\0/.test(s)) s = s.replace(/\0/g, '');
  if (options?.collapseLines) {
    s = s.replace(/[\r\n]+/g, ' ').trim();
  }
  const max = options?.maxChars;
  if (typeof max === 'number' && max > 0 && s.length > max) {
    s = s.slice(0, max);
  }
  return s;
}

/** Practical bound for clipboard / preformatted node output. */
export const NODE_OUTPUT_MAX_CHARS = 100_000;

/** Serialize node output for clipboard / export (null-byte scrubbed, size-capped). */
export function serializeNodeOutput(output: unknown, maxChars = NODE_OUTPUT_MAX_CHARS): string {
  const cap = typeof maxChars === 'number' && maxChars > 0 ? maxChars : NODE_OUTPUT_MAX_CHARS;
  if (typeof output === 'string') return scrubDisplayText(output, { maxChars: cap });
  try {
    return scrubDisplayText(JSON.stringify(output, null, 2), { maxChars: cap });
  } catch {
    return scrubDisplayText(String(output), { maxChars: cap });
  }
}
