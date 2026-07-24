/**
 * Process-local runtime context for the engine server.
 * Auth token and listen port are set at startup (index.ts) and read by
 * CLI spawn / workflow helpers so child processes can call back into the API.
 */

let authToken = '';
let port = 3000;

const DEFAULT_PORT = 3000;

/** Clamp listen port to a valid TCP port (1–65535); invalid → default. */
export function normalizeListenPort(raw: unknown, fallback = DEFAULT_PORT): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(n)) return fallback;
  const p = Math.floor(n);
  if (p < 1 || p > 65535) return fallback;
  return p;
}

export function setRuntimeContext(ctx: { authToken: string; port: number }): void {
  authToken = typeof ctx.authToken === 'string' ? ctx.authToken.trim() : String(ctx.authToken ?? '');
  port = normalizeListenPort(ctx.port, port || DEFAULT_PORT);
}

export function getRuntimeAuthToken(): string {
  return authToken;
}

export function getRuntimeServerUrl(): string {
  return `http://127.0.0.1:${port}`;
}

export function getRuntimePort(): number {
  return port;
}
