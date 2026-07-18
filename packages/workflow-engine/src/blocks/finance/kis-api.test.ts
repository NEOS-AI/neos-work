import { afterEach, describe, expect, it, vi } from 'vitest';
import { getKisToken, getStockPrice } from './kis-api.js';

describe('kis-api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches and caches access token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-1', expires_in: 3600 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const config = { appKey: 'key-a', appSecret: 'sec-a' };
    const t1 = await getKisToken(config);
    const t2 = await getKisToken(config);
    expect(t1).toBe('tok-1');
    expect(t2).toBe('tok-1');
    // second call should hit cache
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on token HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    }));
    await expect(getKisToken({ appKey: 'k', appSecret: 'unique-fail' })).rejects.toThrow(/401/);
  });

  it('fetches stock price after token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-price', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: {
            stck_prpr: '70000',
            stck_oprc: '69000',
            stck_hgpr: '71000',
            stck_lwpr: '68500',
            acml_vol: '1000',
            prdy_ctrt: '1.45',
            hts_kor_isnm: 'Test Corp',
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    // use unique credentials to avoid cache collision with previous test
    const price = await getStockPrice({ appKey: 'price-key', appSecret: 'price-sec' }, '005930');
    expect(price.symbol).toBe('005930');
    expect(price.currentPrice).toBe(70000);
    expect(price.changePercent).toBeCloseTo(1.45);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
