import * as cron from 'node-cron';
import { describe, expect, it } from 'vitest';

/**
 * Lightweight coverage for DST-related scheduling assumptions:
 * node-cron accepts IANA timezones and validates cron expressions.
 */
describe('routine cron / timezone assumptions', () => {
  it('validates common cron presets', () => {
    expect(cron.validate('0 9 * * *')).toBe(true);
    expect(cron.validate('*/15 * * * *')).toBe(true);
    expect(cron.validate('0 * * * *')).toBe(true);
    expect(cron.validate('not a cron')).toBe(false);
    expect(cron.validate('')).toBe(false);
  });

  it('accepts IANA timezones when scheduling (no throw)', () => {
    const task = cron.schedule(
      '0 9 * * *',
      () => {},
      { timezone: 'Asia/Seoul' },
    );
    expect(task).toBeDefined();
    task.stop();
  });

  it('accepts America/New_York for DST zones', () => {
    const task = cron.schedule(
      '0 9 * * *',
      () => {},
      { timezone: 'America/New_York' },
    );
    expect(task).toBeDefined();
    task.stop();
  });
});
