import { describe, expect, it } from 'vitest';
import {
  formatAbsoluteTime,
  formatRelativeTime,
  parseTimestampMs,
} from './format-relative-time.js';

describe('parseTimestampMs', () => {
  it('parses ISO with Z', () => {
    expect(parseTimestampMs('2026-06-01T12:00:00.000Z')).toBe(
      Date.parse('2026-06-01T12:00:00.000Z'),
    );
  });

  it('treats SQLite datetime strings as UTC', () => {
    expect(parseTimestampMs('2026-06-01 12:00:00')).toBe(
      Date.parse('2026-06-01T12:00:00.000Z'),
    );
    expect(parseTimestampMs('2026-06-01 12:00:00.123')).toBe(
      Date.parse('2026-06-01T12:00:00.123Z'),
    );
  });

  it('returns NaN for empty/invalid', () => {
    expect(Number.isNaN(parseTimestampMs(undefined))).toBe(true);
    expect(Number.isNaN(parseTimestampMs(''))).toBe(true);
    expect(Number.isNaN(parseTimestampMs('not-a-date'))).toBe(true);
  });
});

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

  it('handles SQLite UTC timestamps the same as ISO Z', () => {
    expect(formatRelativeTime('2026-06-01 11:30:00', now)).toBe('30m ago');
  });
});

describe('formatAbsoluteTime', () => {
  it('returns em dash for empty', () => {
    expect(formatAbsoluteTime(null)).toBe('—');
  });

  it('returns a locale string for valid timestamps', () => {
    const s = formatAbsoluteTime('2026-06-01T12:00:00.000Z');
    expect(s).not.toBe('—');
    expect(s.length).toBeGreaterThan(0);
  });
});
