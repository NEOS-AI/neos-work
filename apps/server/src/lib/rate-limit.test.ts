import { beforeEach, describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter } from './rate-limit.js';

describe('FixedWindowRateLimiter', () => {
  let limiter: FixedWindowRateLimiter;

  beforeEach(() => {
    limiter = new FixedWindowRateLimiter(3, 1_000);
  });

  it('allows up to limit requests in a window', () => {
    const now = 1_000_000;
    expect(limiter.check('a', now)).toBe(true);
    expect(limiter.check('a', now + 1)).toBe(true);
    expect(limiter.check('a', now + 2)).toBe(true);
    expect(limiter.check('a', now + 3)).toBe(false);
  });

  it('resets after window expires', () => {
    const now = 1_000_000;
    expect(limiter.check('b', now)).toBe(true);
    expect(limiter.check('b', now + 1)).toBe(true);
    expect(limiter.check('b', now + 2)).toBe(true);
    expect(limiter.check('b', now + 3)).toBe(false);
    // past window
    expect(limiter.check('b', now + 1_001)).toBe(true);
    expect(limiter.status('b', now + 1_001).remaining).toBe(2);
  });

  it('tracks keys independently', () => {
    const now = 5_000;
    expect(limiter.check('x', now)).toBe(true);
    expect(limiter.check('y', now)).toBe(true);
    expect(limiter.status('x', now).remaining).toBe(2);
    expect(limiter.status('y', now).remaining).toBe(2);
  });

  it('status reflects remaining without consuming when window empty', () => {
    const now = 9_000;
    const st = limiter.status('fresh', now);
    expect(st.limit).toBe(3);
    expect(st.remaining).toBe(3);
    expect(st.windowMs).toBe(1_000);
    expect(st.resetAt).toBe(now + 1_000);
  });

  it('reset clears state', () => {
    const now = 10_000;
    limiter.check('z', now);
    limiter.check('z', now);
    limiter.reset();
    expect(limiter.status('z', now).remaining).toBe(3);
  });
});
