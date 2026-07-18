import { describe, expect, it } from 'vitest';
import { health } from './health.js';

describe('GET /health', () => {
  it('returns ok status, version, and non-negative uptime', async () => {
    const res = await health.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; version: string; uptime: number };
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.version.length).toBeGreaterThan(0);
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});
