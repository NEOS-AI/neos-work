import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OhlcBar, StockPrice } from './kis-api.js';
import type { BlockExecutionContext } from '../types.js';
import { getNativeExecutor, listBlocks, resolveBlock } from '../registry.js';

const getStockPrice = vi.fn();
const getStockChart = vi.fn();

vi.mock('./kis-api.js', () => ({
  getStockPrice: (...args: unknown[]) => getStockPrice(...args),
  getStockChart: (...args: unknown[]) => getStockChart(...args),
}));

// Import after mock so registerNativeBlock uses mocked kis-api
const { registerFinanceBlocks } = await import('./index.js');

function price(partial: Partial<StockPrice> & { symbol: string }): StockPrice {
  return {
    currentPrice: 100,
    openPrice: 99,
    highPrice: 105,
    lowPrice: 98,
    volume: 1_000,
    changePercent: 0,
    ...partial,
  };
}

/** Synthetic daily bars newest-first (as returned by getStockChart). */
function barsNewestFirst(closes: number[]): OhlcBar[] {
  return closes.map((close, i) => ({
    date: `2024-01-${String(closes.length - i).padStart(2, '0')}`,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 1000 + i,
  }));
}

/** Rising then falling series for MA/RSI/MACD/risk (oldest → newest). */
function syntheticCloses(n = 80): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(100 + i * 0.5 + Math.sin(i / 5) * 3);
  }
  return out;
}

function ctx(
  params: Record<string, unknown> = {},
  extras: Partial<BlockExecutionContext> = {},
): BlockExecutionContext {
  return {
    params,
    inputs: {},
    settings: {
      KIS_APP_KEY: 'test-key',
      KIS_APP_SECRET: 'test-secret',
    },
    ...extras,
  };
}

beforeAll(() => {
  registerFinanceBlocks();
});

beforeEach(() => {
  getStockPrice.mockReset();
  getStockChart.mockReset();
});

describe('finance block metadata', () => {
  const ids = [
    'price_lookup',
    'moving_average',
    'rsi',
    'macd',
    'portfolio_summary',
    'risk_report',
  ] as const;

  it('registers all six finance blocks with metadata', () => {
    for (const id of ids) {
      expect(getNativeExecutor(id)).toBeDefined();
      const meta = resolveBlock(id);
      expect(meta).toBeDefined();
      expect(meta?.domain).toBe('finance');
      expect(meta?.isBuiltIn).toBe(true);
      expect(meta?.implementationType).toBe('native');
      expect(meta?.paramDefs.length).toBeGreaterThan(0);
    }
  });

  it('lists finance domain blocks', () => {
    const finance = listBlocks('finance');
    for (const id of ids) {
      expect(finance.some((b) => b.id === id)).toBe(true);
    }
    expect(finance.every((b) => b.domain === 'finance')).toBe(true);
  });
});

describe('price_lookup', () => {
  const exec = () => getNativeExecutor('price_lookup')!;

  it('returns price when symbol is provided', async () => {
    getStockPrice.mockResolvedValue(price({ symbol: '005930', currentPrice: 70_000, changePercent: 1.2 }));
    const result = await exec().execute(ctx({ symbol: '005930' }));
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({ symbol: '005930', currentPrice: 70_000 });
    expect(getStockPrice).toHaveBeenCalledWith(
      { appKey: 'test-key', appSecret: 'test-secret' },
      '005930',
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reads symbol from inputs when params omit it', async () => {
    getStockPrice.mockResolvedValue(price({ symbol: '000660' }));
    const result = await exec().execute(ctx({}, { inputs: { symbol: '000660' } }));
    expect(result.ok).toBe(true);
    expect(getStockPrice).toHaveBeenCalledWith(expect.anything(), '000660');
  });

  it('fails when symbol is missing', async () => {
    const result = await exec().execute(ctx({}));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/symbol is required/);
    expect(getStockPrice).not.toHaveBeenCalled();
  });

  it('fails when symbol is whitespace-only and trims padded symbols', async () => {
    const blank = await exec().execute(ctx({ symbol: '   ' }));
    expect(blank.ok).toBe(false);
    expect(blank.error).toMatch(/symbol is required/);

    getStockPrice.mockResolvedValue(price({ symbol: '005930' }));
    const padded = await exec().execute(ctx({ symbol: '  005930  ' }));
    expect(padded.ok).toBe(true);
    expect(getStockPrice).toHaveBeenCalledWith(expect.anything(), '005930');
  });

  it('fails when KIS credentials are missing', async () => {
    const result = await exec().execute(
      ctx({ symbol: '005930' }, { settings: {} }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/KIS_APP_KEY/);
  });

  it('surfaces API errors', async () => {
    getStockPrice.mockRejectedValue(new Error('KIS price request failed (500)'));
    const result = await exec().execute(ctx({ symbol: '005930' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
  });
});

describe('moving_average', () => {
  const exec = () => getNativeExecutor('moving_average')!;

  beforeEach(() => {
    // getStockChart returns newest-first; index reverses to oldest-first
    const closesOldestFirst = syntheticCloses(80);
    getStockChart.mockResolvedValue(barsNewestFirst([...closesOldestFirst].reverse()));
  });

  it('computes SMA by default', async () => {
    const result = await exec().execute(ctx({ symbol: '005930', period: 20 }));
    expect(result.ok).toBe(true);
    const out = result.output as {
      type: string;
      period: number;
      current: number;
      series: number[];
    };
    expect(out.type).toBe('SMA');
    expect(out.period).toBe(20);
    expect(typeof out.current).toBe('number');
    expect(out.series.length).toBeGreaterThan(0);
    expect(out.series.length).toBeLessThanOrEqual(20);
  });

  it('clamps invalid period and unknown MA type to SMA defaults', async () => {
    const result = await exec().execute(
      ctx({ symbol: '005930', period: -5, type: 'WMA' }),
    );
    expect(result.ok).toBe(true);
    const out = result.output as { type: string; period: number };
    expect(out.type).toBe('SMA');
    expect(out.period).toBe(20);

    // Above max (500) clamps to 500
    const high = await exec().execute(
      ctx({ symbol: '005930', period: 9999, type: 'SMA' }),
    );
    expect(high.ok).toBe(true);
    expect((high.output as { period: number }).period).toBe(500);

    // Non-finite → fallback 20
    const nan = await exec().execute(
      ctx({ symbol: '005930', period: Number.NaN }),
    );
    expect(nan.ok).toBe(true);
    expect((nan.output as { period: number }).period).toBe(20);
  });

  it('computes EMA when type is EMA', async () => {
    const result = await exec().execute(ctx({ symbol: '005930', period: 12, type: 'EMA' }));
    expect(result.ok).toBe(true);
    expect((result.output as { type: string }).type).toBe('EMA');
  });

  it('fails without credentials', async () => {
    const result = await exec().execute(
      ctx({ symbol: '005930' }, { settings: { KIS_APP_KEY: 'only-key' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/KIS_APP/);
  });
});

describe('rsi', () => {
  const exec = () => getNativeExecutor('rsi')!;

  it('returns neutral/overbought/oversold signal from current RSI', async () => {
    const closesOldestFirst = syntheticCloses(80); // strong uptrend → high RSI
    getStockChart.mockResolvedValue(barsNewestFirst([...closesOldestFirst].reverse()));

    const result = await exec().execute(ctx({ symbol: '005930', period: 14 }));
    expect(result.ok).toBe(true);
    const out = result.output as {
      current: number;
      signal: string;
      series: number[];
    };
    expect(typeof out.current).toBe('number');
    expect(['overbought', 'oversold', 'neutral', 'unknown']).toContain(out.signal);
    // rising series should be overbought
    expect(out.signal).toBe('overbought');
    expect(out.series.length).toBeGreaterThan(0);
  });

  it('marks oversold when prices fall hard', async () => {
    const closesOldestFirst = Array.from({ length: 80 }, (_, i) => 200 - i * 1.5);
    getStockChart.mockResolvedValue(barsNewestFirst([...closesOldestFirst].reverse()));

    const result = await exec().execute(ctx({ symbol: '005930' }));
    expect(result.ok).toBe(true);
    expect((result.output as { signal: string }).signal).toBe('oversold');
  });

  it('fails when chart API throws', async () => {
    getStockChart.mockRejectedValue(new Error('chart down'));
    const result = await exec().execute(ctx({ symbol: '005930' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/chart down/);
  });
});

describe('macd', () => {
  const exec = () => getNativeExecutor('macd')!;

  it('returns MACD series and bullish/bearish signal', async () => {
    const closesOldestFirst = syntheticCloses(120);
    getStockChart.mockResolvedValue(barsNewestFirst([...closesOldestFirst].reverse()));

    const result = await exec().execute(
      ctx({ symbol: '005930', fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }),
    );
    expect(result.ok).toBe(true);
    const out = result.output as {
      signal: string;
      histogram: number | null;
      current: unknown;
      series: unknown[];
    };
    expect(['bullish', 'bearish', 'unknown']).toContain(out.signal);
    expect(out.current).toBeTruthy();
    expect(out.series.length).toBeGreaterThan(0);
    expect(out.series.length).toBeLessThanOrEqual(20);
  });

  it('fails without symbol path through API error when config missing', async () => {
    const result = await exec().execute(ctx({ symbol: 'x' }, { settings: {} }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/KIS_APP_KEY/);
  });
});

describe('portfolio_summary', () => {
  const exec = () => getNativeExecutor('portfolio_summary')!;

  it('aggregates comma-separated symbols', async () => {
    getStockPrice
      .mockResolvedValueOnce(price({ symbol: '005930', currentPrice: 100, changePercent: 2 }))
      .mockResolvedValueOnce(price({ symbol: '000660', currentPrice: 50, changePercent: -1 }));

    const result = await exec().execute(ctx({ symbols: '005930, 000660' }));
    expect(result.ok).toBe(true);
    const out = result.output as {
      count: number;
      totalValue: number;
      gainers: number;
      losers: number;
      items: StockPrice[];
    };
    expect(out.count).toBe(2);
    expect(out.totalValue).toBe(150);
    expect(out.gainers).toBe(1);
    expect(out.losers).toBe(1);
    expect(out.items).toHaveLength(2);
  });

  it('accepts symbols as an array from inputs', async () => {
    getStockPrice.mockResolvedValue(price({ symbol: 'A', currentPrice: 10, changePercent: 0 }));
    const result = await exec().execute(
      ctx({}, { inputs: { symbols: ['A'] } }),
    );
    expect(result.ok).toBe(true);
    expect((result.output as { count: number }).count).toBe(1);
  });

  it('requires at least one symbol', async () => {
    const result = await exec().execute(ctx({ symbols: '  ,  ' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/symbols is required/);
  });

  it('rejects more than 20 symbols', async () => {
    const many = Array.from({ length: 21 }, (_, i) => `S${i}`).join(',');
    const result = await exec().execute(ctx({ symbols: many }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Maximum 20/);
    expect(getStockPrice).not.toHaveBeenCalled();
  });
});

describe('risk_report', () => {
  const exec = () => getNativeExecutor('risk_report')!;

  it('computes volatility, max drawdown, sharpe and risk level', async () => {
    // Oscillating series with a clear peak→trough for drawdown
    const closesOldestFirst: number[] = [];
    for (let i = 0; i < 60; i++) {
      closesOldestFirst.push(100 + Math.sin(i / 4) * 10 + i * 0.1);
    }
    getStockChart.mockResolvedValue(barsNewestFirst([...closesOldestFirst].reverse()));

    const result = await exec().execute(ctx({ symbol: '005930', lookback: 60 }));
    expect(result.ok).toBe(true);
    const out = result.output as {
      symbol: string;
      dailyVolatility: number;
      annualisedVolatility: number;
      maxDrawdown: number;
      sharpeRatio: number | null;
      riskLevel: string;
      lookbackDays: number;
    };
    expect(out.symbol).toBe('005930');
    expect(out.dailyVolatility).toBeGreaterThan(0);
    expect(out.annualisedVolatility).toBeGreaterThan(0);
    expect(out.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(out.maxDrawdown).toBeLessThanOrEqual(1);
    expect(out.sharpeRatio === null || typeof out.sharpeRatio === 'number').toBe(true);
    expect(['low', 'medium', 'high']).toContain(out.riskLevel);
    expect(out.lookbackDays).toBeGreaterThanOrEqual(5);
  });

  it('requires symbol', async () => {
    const result = await exec().execute(ctx({}));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/symbol is required/);
  });

  it('fails when insufficient chart data', async () => {
    getStockChart.mockResolvedValue(barsNewestFirst([1, 2, 3]));
    const result = await exec().execute(ctx({ symbol: '005930', lookback: 60 }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Insufficient data/);
  });

  it('classifies low risk for nearly flat series', async () => {
    const flat = Array.from({ length: 60 }, () => 100);
    // tiny noise so variance is tiny but non-zero path still runs
    flat[30] = 100.01;
    getStockChart.mockResolvedValue(barsNewestFirst(flat));

    const result = await exec().execute(ctx({ symbol: 'FLAT', lookback: 60 }));
    expect(result.ok).toBe(true);
    expect((result.output as { riskLevel: string }).riskLevel).toBe('low');
  });
});
