import { describe, expect, it } from 'vitest';
import { formatDuration, formatDurationMs, serializeNodeOutput } from './format-duration.js';

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
});

describe('serializeNodeOutput', () => {
  it('returns strings as-is and JSON for objects', () => {
    expect(serializeNodeOutput('hello')).toBe('hello');
    expect(serializeNodeOutput({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
