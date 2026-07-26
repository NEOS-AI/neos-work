/**
 * Lightweight Chrome DevTools Protocol probe for TradingView Desktop.
 * Does not scrape charts — only checks that CDP is listening (default 9222).
 */

export interface TradingViewCdpHealth {
  ok: boolean;
  cdpConnected: boolean;
  port: number;
  browser?: string;
  protocolVersion?: string;
  webSocketDebuggerUrl?: string;
  targetCount?: number;
  error?: string;
}

const PORT_MIN = 1;
const PORT_MAX = 65_535;
const DEFAULT_PORT = 9222;
const FETCH_TIMEOUT_MS = 3_000;

export function normalizeCdpPort(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PORT;
  const p = Math.floor(n);
  if (p < PORT_MIN || p > PORT_MAX) return DEFAULT_PORT;
  return p;
}

/**
 * Probe localhost CDP HTTP endpoints used by Chromium/Electron apps.
 * Safe for Settings "Test connection" — no auth, no chart data leave the machine.
 */
export async function checkTradingViewCdp(
  portRaw: unknown = DEFAULT_PORT,
  fetchImpl: typeof fetch = fetch,
): Promise<TradingViewCdpHealth> {
  const port = normalizeCdpPort(portRaw);
  const base = `http://127.0.0.1:${port}`;

  try {
    const versionRes = await fetchImpl(`${base}/json/version`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!versionRes.ok) {
      return {
        ok: false,
        cdpConnected: false,
        port,
        error: `CDP /json/version returned HTTP ${versionRes.status}`,
      };
    }

    let browser: string | undefined;
    let protocolVersion: string | undefined;
    let webSocketDebuggerUrl: string | undefined;
    try {
      const body = (await versionRes.json()) as Record<string, unknown>;
      if (typeof body.Browser === 'string' && !/[\0\r\n]/.test(body.Browser)) {
        browser = body.Browser.trim().slice(0, 200) || undefined;
      }
      if (
        typeof body['Protocol-Version'] === 'string'
        && !/[\0\r\n]/.test(body['Protocol-Version'])
      ) {
        protocolVersion = body['Protocol-Version'].trim().slice(0, 50) || undefined;
      }
      if (
        typeof body.webSocketDebuggerUrl === 'string'
        && !/[\0\r\n]/.test(body.webSocketDebuggerUrl)
      ) {
        const ws = body.webSocketDebuggerUrl.trim();
        if (ws.startsWith('ws://') || ws.startsWith('wss://')) {
          webSocketDebuggerUrl = ws.slice(0, 500);
        }
      }
    } catch {
      // non-JSON body still means something is listening
    }

    let targetCount: number | undefined;
    try {
      const listRes = await fetchImpl(`${base}/json/list`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (listRes.ok) {
        const list = (await listRes.json()) as unknown;
        if (Array.isArray(list)) targetCount = list.length;
      }
    } catch {
      // version succeeded; list optional
    }

    return {
      ok: true,
      cdpConnected: true,
      port,
      browser,
      protocolVersion,
      webSocketDebuggerUrl,
      targetCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const safe =
      typeof msg === 'string' && !/[\0\r\n]/.test(msg)
        ? msg.replace(/[\r\n]+/g, ' ').trim().slice(0, 300)
        : 'CDP connection failed';
    return {
      ok: false,
      cdpConnected: false,
      port,
      error:
        safe
        || 'TradingView CDP not reachable. Launch Desktop with --remote-debugging-port=9222',
    };
  }
}
