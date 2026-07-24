/**
 * KIS (Korea Investment & Securities) Developers API client.
 * Handles OAuth2 token acquisition and REST API calls.
 *
 * Docs: https://apiportal.koreainvestment.com/
 */

import { createHash } from 'node:crypto';

const KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443';
const CHART_PERIODS = new Set(['D', 'W', 'M']);

export interface KisConfig {
  appKey: string;
  appSecret: string;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

// Module-level token cache (per process lifetime)
const tokenCache = new Map<string, TokenCache>();

function normalizeConfig(config: KisConfig): KisConfig {
  return {
    appKey: typeof config.appKey === 'string' ? config.appKey.trim() : '',
    appSecret: typeof config.appSecret === 'string' ? config.appSecret.trim() : '',
  };
}

function normalizeSymbol(symbol: string): string {
  return typeof symbol === 'string' ? symbol.trim() : '';
}

async function kisFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`KIS network error: ${msg}`);
  }
}

export async function getKisToken(config: KisConfig): Promise<string> {
  const { appKey, appSecret } = normalizeConfig(config);
  if (!appKey || !appSecret) {
    throw new Error('KIS_APP_KEY and KIS_APP_SECRET are required');
  }

  // Hash the cache key so appSecret is never stored in plaintext as a Map key
  const cacheKey = createHash('sha256').update(`${appKey}:${appSecret}`).digest('hex');
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const res = await kisFetch(`${KIS_BASE_URL}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: appKey,
      appsecret: appSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KIS token request failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = await res.json() as { access_token?: string; expires_in?: number };
  const token = typeof data.access_token === 'string' ? data.access_token.trim() : '';
  if (!token) {
    throw new Error('KIS token response missing access_token');
  }
  const expiresAt = Date.now() + (data.expires_in ?? 86400) * 1000;
  tokenCache.set(cacheKey, { token, expiresAt });
  return token;
}

export interface StockPrice {
  symbol: string;
  name?: string;
  currentPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  changePercent: number;
}

/**
 * 주식 현재가 조회 (국내 주식)
 */
export async function getStockPrice(config: KisConfig, symbol: string): Promise<StockPrice> {
  const sym = normalizeSymbol(symbol);
  if (!sym) throw new Error('symbol is required');
  const { appKey, appSecret } = normalizeConfig(config);
  const token = await getKisToken({ appKey, appSecret });

  const url = new URL(`${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-price`);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J');
  url.searchParams.set('FID_INPUT_ISCD', sym);

  const res = await kisFetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'appkey': appKey,
      'appsecret': appSecret,
      'tr_id': 'FHKST01010100',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KIS price request failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = await res.json() as { output?: Record<string, string> };
  const o = data.output ?? {};

  return {
    symbol: sym,
    name: o['hts_kor_isnm'],
    currentPrice: parseFloat(o['stck_prpr'] ?? '0'),
    openPrice: parseFloat(o['stck_oprc'] ?? '0'),
    highPrice: parseFloat(o['stck_hgpr'] ?? '0'),
    lowPrice: parseFloat(o['stck_lwpr'] ?? '0'),
    volume: parseInt(o['acml_vol'] ?? '0', 10),
    changePercent: parseFloat(o['prdy_ctrt'] ?? '0'),
  };
}

export interface OhlcBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 주식 일봉/주봉 차트 조회
 */
export async function getStockChart(
  config: KisConfig,
  symbol: string,
  period: 'D' | 'W' | 'M' = 'D',
  count = 60,
): Promise<OhlcBar[]> {
  const sym = normalizeSymbol(symbol);
  if (!sym) throw new Error('symbol is required');
  const periodRaw =
    typeof period === 'string' ? period.trim().toUpperCase() : String(period ?? 'D').trim().toUpperCase();
  const periodCode = (CHART_PERIODS.has(periodRaw) ? periodRaw : 'D') as 'D' | 'W' | 'M';
  const barCount = Math.min(Math.max(Number(count) || 60, 1), 500);
  const { appKey, appSecret } = normalizeConfig(config);
  const token = await getKisToken({ appKey, appSecret });

  const today = new Date();
  const endDate = today.toISOString().slice(0, 10).replace(/-/g, '');
  // Multiply by 1.5 to account for weekends and holidays — actual trading days
  // are ~5/7 of calendar days, so requesting more ensures we get `count` bars.
  const calendarDays = Math.ceil(barCount * 1.5);
  const startDate = new Date(today.getTime() - calendarDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10).replace(/-/g, '');

  const url = new URL(`${KIS_BASE_URL}/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice`);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE', 'J');
  url.searchParams.set('FID_INPUT_ISCD', sym);
  url.searchParams.set('FID_INPUT_DATE_1', startDate);
  url.searchParams.set('FID_INPUT_DATE_2', endDate);
  url.searchParams.set('FID_PERIOD_DIV_CODE', periodCode);
  url.searchParams.set('FID_ORG_ADJ_PRC', '0');

  const res = await kisFetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${token}`,
      'appkey': appKey,
      'appsecret': appSecret,
      'tr_id': 'FHKST03010100',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`KIS chart request failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const data = await res.json() as { output2?: Array<Record<string, string>> };
  return (data.output2 ?? []).slice(0, barCount).map((r) => ({
    date: r['stck_bsop_date'] ?? '',
    open: parseFloat(r['stck_oprc'] ?? '0'),
    high: parseFloat(r['stck_hgpr'] ?? '0'),
    low: parseFloat(r['stck_lwpr'] ?? '0'),
    close: parseFloat(r['stck_clpr'] ?? '0'),
    volume: parseInt(r['acml_vol'] ?? '0', 10),
  }));
}
