import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './format-relative-time.js';

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-06-01T12:00:00.000Z');

  it('handles empty and invalid', () => {
    expect(formatRelativeTime(undefined, now)).toBe('—');
    expect(formatRelativeTime('not-a-date', now)).toBe('—');
  });

  it('formats past durations', () => {
    expect(formatRelativeTime('2026-06-01T11:59:30.000Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-06-01T11:30:00.000Z', now)).toBe('30m ago');
    expect(formatRelativeTime('2026-06-01T06:00:00.000Z', now)).toBe('6h ago');
    expect(formatRelativeTime('2026-05-30T12:00:00.000Z', now)).toBe('2d ago');
  });

  it('formats future durations (e.g. next run)', () => {
    expect(formatRelativeTime('2026-06-01T18:00:00.000Z', now)).toBe('in 6h');
    expect(formatRelativeTime('2026-06-03T12:00:00.000Z', now)).toBe('in 2d');
  });
});
