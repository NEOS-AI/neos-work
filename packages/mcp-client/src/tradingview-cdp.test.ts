import { describe, expect, it, vi } from 'vitest';
import { checkTradingViewCdp, normalizeCdpPort } from './tradingview-cdp.js';

describe('TradingView CDP probe', () => {
  it('normalizeCdpPort clamps and defaults', () => {
    expect(normalizeCdpPort(9222)).toBe(9222);
    expect(normalizeCdpPort('9222')).toBe(9222);
    expect(normalizeCdpPort(0)).toBe(9222);
    expect(normalizeCdpPort(99_999)).toBe(9222);
    expect(normalizeCdpPort('x')).toBe(9222);
  });

  it('returns connected health when version + list succeed', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/json/version')) {
        return {
          ok: true,
          json: async () => ({
            Browser: 'Chrome/120',
            'Protocol-Version': '1.3',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/x',
          }),
        };
      }
      return {
        ok: true,
        json: async () => [{ id: '1' }, { id: '2' }],
      };
    }) as unknown as typeof fetch;

    const health = await checkTradingViewCdp(9222, fetchImpl);
    expect(health.ok).toBe(true);
    expect(health.cdpConnected).toBe(true);
    expect(health.browser).toBe('Chrome/120');
    expect(health.targetCount).toBe(2);
  });

  it('returns not connected on network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;
    const health = await checkTradingViewCdp(9222, fetchImpl);
    expect(health.ok).toBe(false);
    expect(health.cdpConnected).toBe(false);
    expect(health.error).toMatch(/fetch failed|CDP/i);
  });
});
