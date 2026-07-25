/**
 * Simple fixed-window rate limiter (in-memory).
 * Used by webhook triggers: 60 requests / 60s per key.
 */

export interface RateLimitStatus {
  limit: number;
  remaining: number;
  resetAt: number;
  windowMs: number;
}

export class FixedWindowRateLimiter {
  private map = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    // Clamp pathological constructor args (defense for shared/misconfigured instances)
    const lim = Number(limit);
    this.limit =
      Number.isFinite(lim) && lim >= 1 ? Math.min(10_000, Math.floor(lim)) : 60;
    const win = Number(windowMs);
    this.windowMs =
      Number.isFinite(win) && win >= 1 ? Math.min(86_400_000, Math.floor(win)) : 60_000;
  }

  /** Cap map key length so pathological keys cannot bloat memory. */
  private static readonly KEY_MAX_CHARS = 200;

  private normalizeKey(key: string): string {
    if (typeof key !== 'string') return '';
    // Reject control chars before trim (trim strips leading/trailing \r\n)
    if (/[\0\r\n]/.test(key)) return '';
    const k = key.trim();
    if (!k) return '';
    return k.length > FixedWindowRateLimiter.KEY_MAX_CHARS
      ? k.slice(0, FixedWindowRateLimiter.KEY_MAX_CHARS)
      : k;
  }

  /** Drop expired windows to bound memory growth under many distinct keys. */
  private gc(now: number): void {
    if (this.map.size < 256) return;
    for (const [key, entry] of this.map) {
      if (now > entry.resetAt) this.map.delete(key);
    }
  }

  /** Returns true if the request is allowed and consumes one unit. */
  check(key: string, now = Date.now()): boolean {
    const k = this.normalizeKey(key);
    // Blank keys are rejected (do not share a global bucket)
    if (!k) return false;
    this.gc(now);
    const entry = this.map.get(k);
    if (!entry || now > entry.resetAt) {
      this.map.set(k, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }

  status(key: string, now = Date.now()): RateLimitStatus {
    const k = this.normalizeKey(key);
    if (!k) {
      return {
        limit: this.limit,
        remaining: 0,
        resetAt: now + this.windowMs,
        windowMs: this.windowMs,
      };
    }
    const entry = this.map.get(k);
    if (!entry || now > entry.resetAt) {
      return {
        limit: this.limit,
        remaining: this.limit,
        resetAt: now + this.windowMs,
        windowMs: this.windowMs,
      };
    }
    return {
      limit: this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      resetAt: entry.resetAt,
      windowMs: this.windowMs,
    };
  }

  /** Test helper — clear all windows */
  reset(): void {
    this.map.clear();
  }
}

/** Shared webhook limiter: 60 req / 60s per workflowId */
export const webhookRateLimiter = new FixedWindowRateLimiter(60, 60_000);
