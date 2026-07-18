import { describe, expect, it } from 'vitest';
import { estimateNextCronRun } from './cron-next.js';

describe('estimateNextCronRun', () => {
  it('returns null for invalid expressions', () => {
    expect(estimateNextCronRun('not a cron')).toBeNull();
    expect(estimateNextCronRun('* * *')).toBeNull();
  });

  it('finds next hourly run at minute 0', () => {
    // 2026-01-01 10:15 UTC → next 11:00 UTC
    const from = new Date('2026-01-01T10:15:00.000Z');
    const next = estimateNextCronRun('0 * * * *', { from, timezone: 'UTC' });
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-01-01T11:00:00.000Z');
  });

  it('respects every-5-minutes step', () => {
    const from = new Date('2026-01-01T10:01:00.000Z');
    const next = estimateNextCronRun('*/5 * * * *', { from, timezone: 'UTC' });
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-01-01T10:05:00.000Z');
  });

  it('handles daily time in UTC', () => {
    const from = new Date('2026-06-01T08:00:00.000Z');
    const next = estimateNextCronRun('30 9 * * *', { from, timezone: 'UTC' });
    expect(next).not.toBeNull();
    expect(next!.toISOString()).toBe('2026-06-01T09:30:00.000Z');
  });

  it('supports comma lists and ranges', () => {
    // minutes 0,15,30,45
    const from = new Date('2026-03-01T12:10:00.000Z');
    const next = estimateNextCronRun('0,15,30,45 * * * *', { from, timezone: 'UTC' });
    expect(next!.toISOString()).toBe('2026-03-01T12:15:00.000Z');

    // hour range 9-11 at minute 0 → from 10:30 → 11:00
    const from2 = new Date('2026-03-01T10:30:00.000Z');
    const next2 = estimateNextCronRun('0 9-11 * * *', { from: from2, timezone: 'UTC' });
    expect(next2!.toISOString()).toBe('2026-03-01T11:00:00.000Z');
  });

  it('returns null for out-of-range field values', () => {
    expect(estimateNextCronRun('60 * * * *')).toBeNull();
    expect(estimateNextCronRun('* 24 * * *')).toBeNull();
    expect(estimateNextCronRun('* * 0 * *')).toBeNull();
  });

  it('matches weekday-restricted schedules', () => {
    // Monday only at 09:00 UTC — 2026-01-01 is Thursday
    const from = new Date('2026-01-01T08:00:00.000Z');
    const next = estimateNextCronRun('0 9 * * 1', { from, timezone: 'UTC' });
    expect(next).not.toBeNull();
    // Next Monday 2026-01-05 09:00 UTC
    expect(next!.toISOString()).toBe('2026-01-05T09:00:00.000Z');
  });

  it('rolls to next day when daily time already passed', () => {
    const from = new Date('2026-06-01T10:00:00.000Z');
    const next = estimateNextCronRun('0 9 * * *', { from, timezone: 'UTC' });
    expect(next!.toISOString()).toBe('2026-06-02T09:00:00.000Z');
  });
});
