import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatDurationMs,
  scrubDisplayText,
  serializeNodeOutput,
} from './format-duration.js';

describe('formatDurationMs', () => {
  it('guards invalid values', () => {
    expect(formatDurationMs(null)).toBe('—');
    expect(formatDurationMs(undefined)).toBe('—');
    expect(formatDurationMs(Number.NaN)).toBe('—');
    expect(formatDurationMs(-1)).toBe('—');
  });

  it('formats ms, seconds, minutes', () => {
    expect(formatDurationMs(450)).toBe('450ms');
    expect(formatDurationMs(2500)).toBe('2.50s');
    expect(formatDurationMs(65_000)).toBe('1m 5s');
  });
});

describe('formatDuration', () => {
  it('returns em dash without completedAt or invalid range', () => {
    expect(formatDuration('2020-01-01T00:00:00.000Z')).toBe('—');
    expect(formatDuration('bad', 'also-bad')).toBe('—');
    expect(formatDuration('2020-01-01T00:01:00.000Z', '2020-01-01T00:00:00.000Z')).toBe('—');
  });

  it('formats ms, seconds, and minutes', () => {
    const start = '2020-01-01T00:00:00.000Z';
    expect(formatDuration(start, '2020-01-01T00:00:00.450Z')).toBe('450ms');
    expect(formatDuration(start, '2020-01-01T00:00:02.500Z')).toBe('2.50s');
    expect(formatDuration(start, '2020-01-01T00:01:05.000Z')).toBe('1m 5s');
  });

  it('parses SQLite UTC datetime strings', () => {
    expect(formatDuration('2020-01-01 00:00:00', '2020-01-01 00:00:30')).toBe('30.00s');
  });
});

describe('scrubDisplayText', () => {
  it('strips null bytes and optionally collapses lines', () => {
    expect(scrubDisplayText(`hi${'\0'}there`)).toBe('hithere');
    expect(scrubDisplayText('a\nb\rc', { collapseLines: true })).toBe('a b c');
    expect(scrubDisplayText('keep\nline')).toBe('keep\nline');
    expect(scrubDisplayText('abcdef', { maxChars: 3 })).toBe('abc');
    expect(scrubDisplayText(null)).toBe('');
  });

  it('coerces non-strings and ignores non-positive maxChars', () => {
    expect(scrubDisplayText(42)).toBe('42');
    expect(scrubDisplayText({ a: 1 })).toBe('[object Object]');
    expect(scrubDisplayText(undefined)).toBe('');
    // maxChars <= 0 is a no-op (not treated as empty string)
    expect(scrubDisplayText('abcdef', { maxChars: 0 })).toBe('abcdef');
    expect(scrubDisplayText('abcdef', { maxChars: -5 })).toBe('abcdef');
    // collapseLines + maxChars apply after null-byte strip
    // `a\0\nb\nc` → strip null → collapse → "a b c" → max 3 → "a b"
    expect(
      scrubDisplayText(`a${'\0'}\nb\nc`, { collapseLines: true, maxChars: 3 }),
    ).toBe('a b');
    expect(scrubDisplayText('line1\nline2', { collapseLines: true, maxChars: 4 })).toBe('line');
  });
});

describe('serializeNodeOutput', () => {
  it('returns strings as-is and JSON for objects', () => {
    expect(serializeNodeOutput('hello')).toBe('hello');
    expect(serializeNodeOutput({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('strips null bytes from string and JSON outputs', () => {
    expect(serializeNodeOutput(`x${'\0'}y`)).toBe('xy');
    expect(serializeNodeOutput({ t: `a${'\0'}b` })).not.toContain('\0');
  });

  it('caps serialized length (display / clipboard defense)', () => {
    expect(serializeNodeOutput('abcdef', 3)).toBe('abc');
    const big = { blob: 'x'.repeat(200) };
    expect(serializeNodeOutput(big, 40).length).toBeLessThanOrEqual(40);
  });

  it('serializes null, numbers, arrays, and falls back for circular values', () => {
    expect(serializeNodeOutput(null)).toBe('null');
    expect(serializeNodeOutput(42)).toBe('42');
    expect(serializeNodeOutput([1, 2])).toBe('[\n  1,\n  2\n]');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeNodeOutput(circular)).toBe('[object Object]');
  });
});

describe('scrubDisplayText non-string coerce', () => {
  it('coerces numbers/objects and strips null from coerced strings', () => {
    expect(scrubDisplayText(42)).toBe('42');
    expect(scrubDisplayText(undefined)).toBe('');
    expect(scrubDisplayText({ toString: () => `a${'\0'}b` })).toBe('ab');
  });
});
