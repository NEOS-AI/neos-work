import { afterEach, describe, expect, it, vi } from 'vitest';
import { getKisToken, getStockChart, getStockPrice } from './kis-api.js';

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

  it('rejects blank credentials and network failures', async () => {
    await expect(getKisToken({ appKey: '  ', appSecret: 'sec' })).rejects.toThrow(/required/i);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(getKisToken({ appKey: 'net-k', appSecret: 'net-s' })).rejects.toThrow(/network/i);
  });

  it('rejects blank symbol before network calls', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(getStockPrice({ appKey: 'k', appSecret: 's' }, '   ')).rejects.toThrow(
      /symbol is required/i,
    );
    await expect(getStockChart({ appKey: 'k', appSecret: 's' }, '')).rejects.toThrow(
      /symbol is required/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(price.name).toBe('Test Corp');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on stock price HTTP error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-price-err', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'unavailable',
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getStockPrice({ appKey: 'price-err-key', appSecret: 'price-err-sec' }, '005930'),
    ).rejects.toThrow(/price request failed \(503\)/);
  });

  it('fetches and maps daily chart bars', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-chart', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output2: [
            {
              stck_bsop_date: '20240115',
              stck_oprc: '100',
              stck_hgpr: '110',
              stck_lwpr: '95',
              stck_clpr: '105',
              acml_vol: '2000',
            },
            {
              stck_bsop_date: '20240114',
              stck_oprc: '98',
              stck_hgpr: '102',
              stck_lwpr: '97',
              stck_clpr: '100',
              acml_vol: '1500',
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const bars = await getStockChart(
      { appKey: 'chart-key', appSecret: 'chart-sec' },
      '005930',
      'D',
      10,
    );
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({
      date: '20240115',
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 2000,
    });
    expect(bars[1]!.close).toBe(100);

    // second call is chart endpoint with tr_id and date params
    const chartCall = fetchMock.mock.calls[1]!;
    const chartUrl = String(chartCall[0]);
    expect(chartUrl).toContain('inquire-daily-itemchartprice');
    expect(chartUrl).toContain('FID_INPUT_ISCD=005930');
    expect(chartUrl).toContain('FID_PERIOD_DIV_CODE=D');
    expect(chartCall[1]?.headers?.tr_id).toBe('FHKST03010100');
  });

  it('returns empty array when chart payload omits output2', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-chart-empty', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
    vi.stubGlobal('fetch', fetchMock);

    const bars = await getStockChart(
      { appKey: 'chart-empty-key', appSecret: 'chart-empty-sec' },
      '000660',
      'W',
      5,
    );
    expect(bars).toEqual([]);
  });

  it('throws on chart HTTP error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok-chart-err', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: async () => 'bad gateway',
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getStockChart({ appKey: 'chart-err-key', appSecret: 'chart-err-sec' }, '005930'),
    ).rejects.toThrow(/chart request failed \(502\)/);
  });
});
