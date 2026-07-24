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

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  private normalizeKey(key: string): string {
    return typeof key === 'string' ? key.trim() : '';
  }

  /** Returns true if the request is allowed and consumes one unit. */
  check(key: string, now = Date.now()): boolean {
    const k = this.normalizeKey(key);
    // Blank keys are rejected (do not share a global bucket)
    if (!k) return false;
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
