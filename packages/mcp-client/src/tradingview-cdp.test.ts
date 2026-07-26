import { describe, expect, it, vi } from 'vitest';
import { checkTradingViewCdp, normalizeCdpPort } from './tradingview-cdp.js';

describe('TradingView CDP probe', () => {
  it('normalizeCdpPort clamps and defaults', () => {
    expect(normalizeCdpPort(9222)).toBe(9222);
    expect(normalizeCdpPort('9222')).toBe(9222);
    expect(normalizeCdpPort(0)).toBe(9222);
    expect(normalizeCdpPort(99_999)).toBe(9222);
    expect(normalizeCdpPort('x')).toBe(9222);
    expect(normalizeCdpPort(1.9)).toBe(1);
    expect(normalizeCdpPort(65_535)).toBe(65_535);
    expect(normalizeCdpPort(Number.NaN)).toBe(9222);
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
    expect(health.protocolVersion).toBe('1.3');
    expect(health.webSocketDebuggerUrl).toBe('ws://127.0.0.1:9222/devtools/browser/x');
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

  it('fails when /json/version is not ok', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const health = await checkTradingViewCdp(9222, fetchImpl);
    expect(health).toMatchObject({
      ok: false,
      cdpConnected: false,
      port: 9222,
      error: expect.stringMatching(/HTTP 503/),
    });
  });

  it('drops control-char / blank version fields and invalid websocket urls', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/json/version')) {
        return {
          ok: true,
          json: async () => ({
            Browser: '   ',
            'Protocol-Version': `1.3${'\n'}x`,
            webSocketDebuggerUrl: 'http://not-ws',
          }),
        };
      }
      return { ok: true, json: async () => ({ not: 'array' }) };
    }) as unknown as typeof fetch;

    const health = await checkTradingViewCdp(9222, fetchImpl);
    expect(health.ok).toBe(true);
    expect(health.browser).toBeUndefined();
    expect(health.protocolVersion).toBeUndefined();
    expect(health.webSocketDebuggerUrl).toBeUndefined();
    expect(health.targetCount).toBeUndefined();
  });

  it('drops whitespace-only Protocol-Version after trim', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/json/version')) {
        return {
          ok: true,
          json: async () => ({
            Browser: 'Chrome',
            'Protocol-Version': '   ',
            webSocketDebuggerUrl: 'ws://127.0.0.1:9222/x',
          }),
        };
      }
      return { ok: false, json: async () => [] };
    }) as unknown as typeof fetch;
    const health = await checkTradingViewCdp(9222, fetchImpl);
    expect(health.ok).toBe(true);
    expect(health.browser).toBe('Chrome');
    expect(health.protocolVersion).toBeUndefined();
    expect(health.targetCount).toBeUndefined(); // list not ok
  });

  it('accepts wss debugger urls and tolerates non-JSON version body', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/json/version')) {
        return {
          ok: true,
          json: async () => {
            throw new Error('not json');
          },
        };
      }
      return {
        ok: true,
        json: async () => [{ id: 't1' }],
      };
    }) as unknown as typeof fetch;

    const health = await checkTradingViewCdp(9222, fetchImpl);
    expect(health.ok).toBe(true);
    expect(health.cdpConnected).toBe(true);
    expect(health.browser).toBeUndefined();
    // list still runs after non-JSON version body
    expect(health.targetCount).toBe(1);
  });

  it('tolerates list endpoint failure after version success', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/json/version')) {
        return {
          ok: true,
          json: async () => ({
            Browser: 'Electron',
            webSocketDebuggerUrl: 'wss://127.0.0.1:9222/x',
          }),
        };
      }
      throw new Error('list down');
    }) as unknown as typeof fetch;

    const health = await checkTradingViewCdp(9222, fetchImpl);
    expect(health.ok).toBe(true);
    expect(health.webSocketDebuggerUrl).toBe('wss://127.0.0.1:9222/x');
    expect(health.targetCount).toBeUndefined();
  });

  it('uses fallback error when thrown message is control-only', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('\n\r\0');
    }) as unknown as typeof fetch;
    const health = await checkTradingViewCdp(9222, fetchImpl);
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/TradingView CDP not reachable|CDP connection failed/i);
  });

  it('uses generic fallback for non-Error throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw 'boom\nline';
    }) as unknown as typeof fetch;
    const health = await checkTradingViewCdp(9222, fetchImpl);
    expect(health.ok).toBe(false);
    // control-char in stringified throw → generic fallback
    expect(health.error).toMatch(/CDP connection failed|TradingView CDP not reachable/i);
  });

  it('uses launch-hint fallback when error message scrubs to empty', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('   ');
    }) as unknown as typeof fetch;
    const health = await checkTradingViewCdp(9222, fetchImpl);
    expect(health.ok).toBe(false);
    expect(health.error).toMatch(/TradingView CDP not reachable|--remote-debugging-port/i);
  });
});
