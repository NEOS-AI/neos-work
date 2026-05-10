/**
 * Finance domain blocks: 6 native blocks using KIS API + technical indicators.
 *
 * Blocks:
 *  1. price_lookup      — 현재 주가 조회
 *  2. moving_average    — 이동평균 계산 (SMA / EMA)
 *  3. rsi               — RSI 계산
 *  4. macd              — MACD 계산
 *  5. portfolio_summary — 복수 종목 현재가 요약
 *  6. risk_report       — 변동성 · 최대낙폭 리포트
 */

import { SMA, EMA, RSI, MACD } from 'technicalindicators';

import type { WorkflowBlock } from '@neos-work/shared';
import type { BlockExecutionContext, BlockResult } from '../types.js';
import { registerNativeBlock } from '../registry.js';
import { getStockPrice, getStockChart } from './kis-api.js';
import type { KisConfig } from './kis-api.js';

function getKisConfig(settings: Record<string, string>): KisConfig {
  const appKey = settings['KIS_APP_KEY'];
  const appSecret = settings['KIS_APP_SECRET'];
  if (!appKey || !appSecret) {
    throw new Error('KIS_APP_KEY and KIS_APP_SECRET are required');
  }
  return { appKey, appSecret };
}

function timer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}

// ── 1. price_lookup ────────────────────────────────────────────────────────

const priceLookupMeta: WorkflowBlock = {
  id: 'price_lookup',
  name: 'Stock Price Lookup',
  domain: 'finance',
  category: 'market-data',
  description: '종목 코드로 현재 주가를 조회합니다. KIS API를 사용합니다.',
  isBuiltIn: true,
  implementationType: 'native',
  paramDefs: [{ key: 'symbol', label: 'Symbol', type: 'string', description: '종목 코드 (예: 005930)' }],
  inputDescription: 'symbol: 종목 코드 문자열',
  outputDescription: '{ symbol, currentPrice, changePercent, volume, ... }',
};

registerNativeBlock({
  blockId: 'price_lookup',
  async execute(ctx: BlockExecutionContext): Promise<BlockResult> {
    const elapsed = timer();
    try {
      const config = getKisConfig(ctx.settings);
      const symbol = String(ctx.params['symbol'] ?? ctx.inputs['symbol'] ?? '');
      if (!symbol) throw new Error('symbol is required');

      const price = await getStockPrice(config, symbol);
      return { ok: true, output: price, durationMs: elapsed() };
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message, durationMs: elapsed() };
    }
  },
}, priceLookupMeta);

// ── 2. moving_average ─────────────────────────────────────────────────────

const movingAverageMeta: WorkflowBlock = {
  id: 'moving_average',
  name: 'Moving Average',
  domain: 'finance',
  category: 'technical-indicator',
  description: 'SMA 또는 EMA 이동평균을 계산합니다.',
  isBuiltIn: true,
  implementationType: 'native',
  paramDefs: [
    { key: 'symbol', label: 'Symbol', type: 'string', description: '종목 코드' },
    { key: 'period', label: 'Period', type: 'number', description: '기간 (기본 20)', default: 20 },
    { key: 'type', label: 'Type', type: 'select', description: 'SMA 또는 EMA', options: ['SMA', 'EMA'], default: 'SMA' },
  ],
  inputDescription: 'symbol, period?, type?',
  outputDescription: '{ symbol, type, period, current, series }',
};

registerNativeBlock({
  blockId: 'moving_average',
  async execute(ctx: BlockExecutionContext): Promise<BlockResult> {
    const elapsed = timer();
    try {
      const config = getKisConfig(ctx.settings);
      const symbol = String(ctx.params['symbol'] ?? ctx.inputs['symbol'] ?? '');
      const period = Number(ctx.params['period'] ?? 20);
      const maType = String(ctx.params['type'] ?? 'SMA').toUpperCase();
      const count = Math.max(period + 5, 60);

      const bars = await getStockChart(config, symbol, 'D', count);
      const closes = bars.map((b) => b.close).reverse(); // oldest first

      let values: number[];
      if (maType === 'EMA') {
        values = EMA.calculate({ period, values: closes });
      } else {
        values = SMA.calculate({ period, values: closes });
      }

      return {
        ok: true,
        output: {
          symbol,
          type: maType,
          period,
          current: values.at(-1),
          series: values.slice(-20),
        },
        durationMs: elapsed(),
      };
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message, durationMs: elapsed() };
    }
  },
}, movingAverageMeta);

// ── 3. rsi ────────────────────────────────────────────────────────────────

const rsiMeta: WorkflowBlock = {
  id: 'rsi',
  name: 'RSI (Relative Strength Index)',
  domain: 'finance',
  category: 'technical-indicator',
  description: 'RSI 지표를 계산하고 과매수/과매도 신호를 반환합니다.',
  isBuiltIn: true,
  implementationType: 'native',
  paramDefs: [
    { key: 'symbol', label: 'Symbol', type: 'string', description: '종목 코드' },
    { key: 'period', label: 'Period', type: 'number', description: '기간 (기본 14)', default: 14 },
  ],
  inputDescription: 'symbol, period?',
  outputDescription: '{ symbol, period, current, signal: overbought|oversold|neutral, series }',
};

registerNativeBlock({
  blockId: 'rsi',
  async execute(ctx: BlockExecutionContext): Promise<BlockResult> {
    const elapsed = timer();
    try {
      const config = getKisConfig(ctx.settings);
      const symbol = String(ctx.params['symbol'] ?? ctx.inputs['symbol'] ?? '');
      const period = Number(ctx.params['period'] ?? 14);
      const count = Math.max(period * 3, 60);

      const bars = await getStockChart(config, symbol, 'D', count);
      const closes = bars.map((b) => b.close).reverse();

      const values = RSI.calculate({ period, values: closes });
      const current = values.at(-1) ?? null;

      return {
        ok: true,
        output: {
          symbol,
          period,
          current,
          signal: current == null ? 'unknown' : current > 70 ? 'overbought' : current < 30 ? 'oversold' : 'neutral',
          series: values.slice(-20),
        },
        durationMs: elapsed(),
      };
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message, durationMs: elapsed() };
    }
  },
}, rsiMeta);

// ── 4. macd ───────────────────────────────────────────────────────────────

const macdMeta: WorkflowBlock = {
  id: 'macd',
  name: 'MACD',
  domain: 'finance',
  category: 'technical-indicator',
  description: 'MACD 지표를 계산하고 강세/약세 신호를 반환합니다.',
  isBuiltIn: true,
  implementationType: 'native',
  paramDefs: [
    { key: 'symbol', label: 'Symbol', type: 'string', description: '종목 코드' },
    { key: 'fastPeriod', label: 'Fast Period', type: 'number', description: '빠른 기간 (기본 12)', default: 12 },
    { key: 'slowPeriod', label: 'Slow Period', type: 'number', description: '느린 기간 (기본 26)', default: 26 },
    { key: 'signalPeriod', label: 'Signal Period', type: 'number', description: '신호 기간 (기본 9)', default: 9 },
  ],
  inputDescription: 'symbol, fastPeriod?, slowPeriod?, signalPeriod?',
  outputDescription: '{ symbol, current, histogram, signal: bullish|bearish, series }',
};

registerNativeBlock({
  blockId: 'macd',
  async execute(ctx: BlockExecutionContext): Promise<BlockResult> {
    const elapsed = timer();
    try {
      const config = getKisConfig(ctx.settings);
      const symbol = String(ctx.params['symbol'] ?? ctx.inputs['symbol'] ?? '');
      const fastPeriod = Number(ctx.params['fastPeriod'] ?? 12);
      const slowPeriod = Number(ctx.params['slowPeriod'] ?? 26);
      const signalPeriod = Number(ctx.params['signalPeriod'] ?? 9);

      const bars = await getStockChart(config, symbol, 'D', 120);
      const closes = bars.map((b) => b.close).reverse();

      const results = MACD.calculate({ values: closes, fastPeriod, slowPeriod, signalPeriod, SimpleMAOscillator: false, SimpleMASignal: false });
      const last = results.at(-1);

      return {
        ok: true,
        output: {
          symbol,
          fastPeriod,
          slowPeriod,
          signalPeriod,
          current: last,
          histogram: last?.histogram ?? null,
          signal: last == null
            ? 'unknown'
            : (last.histogram ?? 0) > 0 ? 'bullish' : 'bearish',
          series: results.slice(-20),
        },
        durationMs: elapsed(),
      };
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message, durationMs: elapsed() };
    }
  },
}, macdMeta);

// ── 5. portfolio_summary ──────────────────────────────────────────────────

const portfolioSummaryMeta: WorkflowBlock = {
  id: 'portfolio_summary',
  name: 'Portfolio Summary',
  domain: 'finance',
  category: 'portfolio',
  description: '복수 종목의 현재 주가를 한 번에 조회하여 포트폴리오 요약을 반환합니다. 최대 20종목.',
  isBuiltIn: true,
  implementationType: 'native',
  paramDefs: [
    { key: 'symbols', label: 'Symbols', type: 'string', description: '쉼표 구분 종목 코드 목록 (예: 005930,000660)' },
  ],
  inputDescription: 'symbols: 쉼표 구분 종목 코드 문자열 또는 배열',
  outputDescription: '{ count, totalValue, items, gainers, losers }',
};

registerNativeBlock({
  blockId: 'portfolio_summary',
  async execute(ctx: BlockExecutionContext): Promise<BlockResult> {
    const elapsed = timer();
    try {
      const config = getKisConfig(ctx.settings);
      const rawSymbols = ctx.params['symbols'] ?? ctx.inputs['symbols'];
      const symbols: string[] = Array.isArray(rawSymbols)
        ? rawSymbols.map(String)
        : String(rawSymbols ?? '').split(',').map((s) => s.trim()).filter(Boolean);

      if (symbols.length === 0) throw new Error('symbols is required');
      if (symbols.length > 20) throw new Error('Maximum 20 symbols per portfolio summary');

      const prices = await Promise.all(symbols.map((s) => getStockPrice(config, s)));
      const totalValue = prices.reduce((sum, p) => sum + p.currentPrice, 0);

      return {
        ok: true,
        output: {
          count: prices.length,
          totalValue,
          items: prices,
          gainers: prices.filter((p) => p.changePercent > 0).length,
          losers: prices.filter((p) => p.changePercent < 0).length,
        },
        durationMs: elapsed(),
      };
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message, durationMs: elapsed() };
    }
  },
}, portfolioSummaryMeta);

// ── 6. risk_report ────────────────────────────────────────────────────────

const riskReportMeta: WorkflowBlock = {
  id: 'risk_report',
  name: 'Risk Report',
  domain: 'finance',
  category: 'risk',
  description: '변동성, 최대낙폭(MDD), 샤프 지수를 계산하여 리스크 리포트를 생성합니다.',
  isBuiltIn: true,
  implementationType: 'native',
  paramDefs: [
    { key: 'symbol', label: 'Symbol', type: 'string', description: '종목 코드' },
    { key: 'lookback', label: 'Lookback Days', type: 'number', description: '분석 기간(일, 기본 60)', default: 60 },
  ],
  inputDescription: 'symbol, lookback?',
  outputDescription: '{ symbol, dailyVolatility, annualisedVolatility, maxDrawdown, sharpeRatio, riskLevel }',
};

registerNativeBlock({
  blockId: 'risk_report',
  async execute(ctx: BlockExecutionContext): Promise<BlockResult> {
    const elapsed = timer();
    try {
      const config = getKisConfig(ctx.settings);
      const symbol = String(ctx.params['symbol'] ?? ctx.inputs['symbol'] ?? '');
      const lookback = Number(ctx.params['lookback'] ?? 60);
      if (!symbol) throw new Error('symbol is required');

      const bars = await getStockChart(config, symbol, 'D', lookback + 5);
      const closes = bars.map((b) => b.close).reverse().slice(-lookback);

      if (closes.length < 5) throw new Error('Insufficient data for risk analysis');

      // Daily returns
      const returns: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        returns.push((closes[i]! - closes[i - 1]!) / closes[i - 1]!);
      }

      // Annualised volatility (std dev of returns * sqrt(252))
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / returns.length;
      const dailyVol = Math.sqrt(variance);
      const annualisedVol = dailyVol * Math.sqrt(252);

      // Max drawdown
      let peak = closes[0]!;
      let maxDrawdown = 0;
      for (const c of closes) {
        if (c > peak) peak = c;
        const dd = (peak - c) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }

      // Sharpe ratio (assume risk-free rate = 3% annualised)
      const riskFreeDaily = 0.03 / 252;
      const excessReturn = mean - riskFreeDaily;
      const sharpe = dailyVol === 0 ? null : (excessReturn / dailyVol) * Math.sqrt(252);

      return {
        ok: true,
        output: {
          symbol,
          lookbackDays: closes.length,
          dailyVolatility: dailyVol,
          annualisedVolatility: annualisedVol,
          maxDrawdown,
          sharpeRatio: sharpe,
          riskLevel: annualisedVol < 0.15 ? 'low' : annualisedVol < 0.30 ? 'medium' : 'high',
        },
        durationMs: elapsed(),
      };
    } catch (e) {
      return { ok: false, output: null, error: (e as Error).message, durationMs: elapsed() };
    }
  },
}, riskReportMeta);

export function registerFinanceBlocks(): void {
  // Blocks are registered at module load time via registerNativeBlock() calls above.
}
