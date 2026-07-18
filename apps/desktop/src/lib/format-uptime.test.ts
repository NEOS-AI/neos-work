import { describe, expect, it } from 'vitest';
import { formatEngineUptime } from './format-uptime.js';

describe('formatEngineUptime', () => {
  it('returns empty for null/undefined/invalid', () => {
    expect(formatEngineUptime(null)).toBe('');
    expect(formatEngineUptime(undefined)).toBe('');
    expect(formatEngineUptime(Number.NaN)).toBe('');
    expect(formatEngineUptime(-1)).toBe('');
  });

  it('formats seconds under a minute', () => {
    expect(formatEngineUptime(0)).toBe('0s up');
    expect(formatEngineUptime(45)).toBe('45s up');
  });

  it('formats minutes under an hour', () => {
    expect(formatEngineUptime(60)).toBe('1m up');
    expect(formatEngineUptime(3599)).toBe('59m up');
  });

  it('formats hours', () => {
    expect(formatEngineUptime(3600)).toBe('1h up');
    expect(formatEngineUptime(7200)).toBe('2h up');
  });
});
