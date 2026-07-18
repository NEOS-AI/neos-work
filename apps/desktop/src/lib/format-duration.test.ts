import { describe, expect, it } from 'vitest';
import { formatDuration } from './format-duration.js';

describe('formatDuration', () => {
  it('returns em dash without completedAt or invalid range', () => {
    expect(formatDuration('2020-01-01T00:00:00.000Z')).toBe('—');
    expect(formatDuration('bad', 'also-bad')).toBe('—');
    expect(formatDuration('2020-01-01T00:01:00.000Z', '2020-01-01T00:00:00.000Z')).toBe('—');
  });

  it('formats ms, seconds, and minutes', () => {
    const start = '2020-01-01T00:00:00.000Z';
    expect(formatDuration(start, '2020-01-01T00:00:00.450Z')).toBe('450ms');
    expect(formatDuration(start, '2020-01-01T00:00:02.500Z')).toBe('2.5s');
    expect(formatDuration(start, '2020-01-01T00:01:05.000Z')).toBe('1m 5s');
  });
});
