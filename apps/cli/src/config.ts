/**
 * CLI runtime config from env (agent-friendly).
 *
 * NEOS_SERVER_URL / NEOS_URL  — default http://127.0.0.1:3000
 * NEOS_AUTH_TOKEN / NEOS_TOKEN — Bearer token from daemon stdout
 * NEOS_PORT                  — used when URL omits port
 * NEOS_PROJECT_ID            — default project for files/run
 * NEOS_PROJECT_DIR           — optional cwd hint for agents
 */

export interface CliConfig {
  serverUrl: string;
  authToken: string | null;
  projectId: string | null;
  projectDir: string | null;
  timeoutMs: number;
}

function cleanEnv(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim();
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
  const token =
    cleanEnv(env.NEOS_AUTH_TOKEN)
    || cleanEnv(env.NEOS_TOKEN)
    || null;

  let serverUrl =
    cleanEnv(env.NEOS_SERVER_URL)
    || cleanEnv(env.NEOS_URL)
    || '';

  if (!serverUrl) {
    const portRaw = cleanEnv(env.NEOS_PORT) || '3000';
    const port = Number(portRaw);
    const p = Number.isFinite(port) && port > 0 && port < 65536 ? Math.trunc(port) : 3000;
    serverUrl = `http://127.0.0.1:${p}`;
  }

  // Normalize trailing slash
  serverUrl = serverUrl.replace(/\/+$/, '');

  const projectId = cleanEnv(env.NEOS_PROJECT_ID) || null;
  const projectDir = cleanEnv(env.NEOS_PROJECT_DIR) || null;

  const timeoutRaw = cleanEnv(env.NEOS_CLI_TIMEOUT_MS);
  const timeoutMs = (() => {
    const n = Number(timeoutRaw);
    if (Number.isFinite(n) && n >= 1_000 && n <= 300_000) return Math.trunc(n);
    return 30_000;
  })();

  return { serverUrl, authToken: token, projectId, projectDir, timeoutMs };
}

export function formatServerLabel(cfg: CliConfig): string {
  try {
    const u = new URL(cfg.serverUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return cfg.serverUrl;
  }
}
