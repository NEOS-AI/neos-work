/**
 * NEOS-as-MCP-server install surface (PLAN_FOR_V0_5_0 Task 16 / OD §14.3–14.4).
 *
 * GET    /api/mcp/install-info
 * GET    /api/mcp/install/codex/status
 * POST   /api/mcp/install/codex
 * DELETE /api/mcp/install/codex
 * GET    /api/mcp/tools  — list tools exposed by neos mcp serve
 */

import { Hono } from 'hono';
import {
  buildMcpInstallInfo,
  listNeosMcpTools,
  resolveNeosBinPath,
  NEOS_MCP_DEFAULT_VERSION,
} from '@neos-work/mcp-client';

import { publicErrorMessage } from '../lib/errors.js';
import {
  getCodexMcpStatus,
  installCodexMcp,
  uninstallCodexMcp,
  type CodexMcpRunner,
} from '../lib/codex-mcp.js';
import { getRuntimeAuthToken, getRuntimeServerUrl } from '../lib/runtime-context.js';

const mcpExpose = new Hono();

/** Injectable for tests */
let codexRunnerOverride: CodexMcpRunner | null = null;

export function setCodexRunnerForTests(runner: CodexMcpRunner | null): void {
  codexRunnerOverride = runner;
}

function cleanQuery(raw: string | undefined, max = 500): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const s = raw.trim();
  if (!s || s.length > max) return '';
  return s;
}

function daemonPort(): number {
  const raw = process.env.PORT ?? process.env.NEOS_PORT ?? '3000';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.trunc(n) : 3000;
}

function defaultServerUrl(): string {
  const fromEnv =
    cleanQuery(process.env.NEOS_PUBLIC_URL, 500)
    || cleanQuery(process.env.NEOS_SERVER_URL, 500);
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return `http://127.0.0.1:${daemonPort()}`;
}

function defaultWebBaseUrl(): string | null {
  const w =
    cleanQuery(process.env.NEOS_WEB_URL, 500)
    || cleanQuery(process.env.NEOS_PUBLIC_URL, 500);
  return w ? w.replace(/\/+$/, '') : null;
}

/**
 * Prefer request-provided neosBin; else NEOS_BIN env; else process argv / execPath.
 */
function resolveBin(queryBin?: string): string {
  const q = cleanQuery(queryBin, 4096);
  if (q) return resolveNeosBinPath({ explicit: q });
  const envBin = cleanQuery(process.env.NEOS_BIN, 4096);
  if (envBin) return resolveNeosBinPath({ explicit: envBin });
  return resolveNeosBinPath({
    argv1: process.env.NEOS_CLI_ENTRY || process.argv[1],
    execPath: process.execPath,
  });
}

// GET /api/mcp/install-info
mcpExpose.get('/install-info', (c) => {
  try {
    const projectId = cleanQuery(c.req.query('projectId'), 100) || null;
    const neosBin = resolveBin(c.req.query('neosBin') ?? undefined);
    const includeToken = c.req.query('includeToken') !== '0' && c.req.query('includeToken') !== 'false';
    // Prefer runtime daemon token (set at boot). Fall back to Bearer echo so
    // install snippets work when clients already authenticated.
    // Pass includeToken=0 to omit secrets from the response body.
    let tokenForSnippet: string | null = null;
    if (includeToken) {
      const rt = getRuntimeAuthToken();
      if (rt && rt.length <= 500) {
        tokenForSnippet = rt;
      } else {
        const authHeader = c.req.header('Authorization') ?? '';
        const m = /^Bearer\s+(\S+)/i.exec(authHeader);
        if (m?.[1] && m[1].length <= 500 && !/[\0\r\n]/.test(m[1])) {
          tokenForSnippet = m[1];
        }
      }
    }

    const serverUrl = (() => {
      try {
        return getRuntimeServerUrl() || defaultServerUrl();
      } catch {
        return defaultServerUrl();
      }
    })();
    const info = buildMcpInstallInfo({
      neosBin,
      serverUrl,
      authToken: tokenForSnippet,
      projectId,
      webBaseUrl: defaultWebBaseUrl(),
    });

    return c.json({
      ok: true,
      data: {
        ...info,
        version: NEOS_MCP_DEFAULT_VERSION,
        tools: listNeosMcpTools().map((t) => ({
          name: t.name,
          description: t.description,
        })),
        notes: [
          'Run `neos mcp serve` as the MCP stdio server (requires daemon + NEOS_AUTH_TOKEN).',
          'Coding agents should set NEOS_PROJECT_ID for default project-scoped tools.',
          'Use includeToken=0 to omit secrets from this response.',
        ],
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: publicErrorMessage(err, 'install-info failed') }, 500);
  }
});

// GET /api/mcp/tools
mcpExpose.get('/tools', (c) => {
  return c.json({
    ok: true,
    data: listNeosMcpTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  });
});

// GET /api/mcp/install/codex/status
mcpExpose.get('/install/codex/status', async (c) => {
  try {
    const runner = codexRunnerOverride ?? undefined;
    const status = await getCodexMcpStatus(runner);
    return c.json({ ok: true, data: status });
  } catch (err) {
    return c.json({ ok: false, error: publicErrorMessage(err, 'codex status failed') }, 500);
  }
});

// POST /api/mcp/install/codex
mcpExpose.post('/install/codex', async (c) => {
  try {
    const raw = await c.req.json().catch(() => null);
    const body =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    const projectId =
      typeof body.projectId === 'string' ? cleanQuery(body.projectId, 100) : '';
    const neosBin = resolveBin(
      typeof body.neosBin === 'string' ? body.neosBin : undefined,
    );

    let authToken: string | null = null;
    if (typeof body.authToken === 'string' && !/[\0\r\n]/.test(body.authToken)) {
      const t = body.authToken.trim();
      if (t && t.length <= 500) authToken = t;
    }
    if (!authToken) {
      const authHeader = c.req.header('Authorization') ?? '';
      const m = /^Bearer\s+(\S+)/i.exec(authHeader);
      if (m?.[1]) authToken = m[1];
    }

    const info = buildMcpInstallInfo({
      neosBin,
      serverUrl: defaultServerUrl(),
      authToken,
      projectId: projectId || null,
    });

    const runner = codexRunnerOverride ?? undefined;
    const result = await installCodexMcp(
      { command: info.command, args: info.args, env: info.env },
      runner,
    );
    if (!result.ok) {
      return c.json(
        {
          ok: false,
          error: result.stderr || result.stdout || 'codex mcp add failed',
          data: { command: result.command, stdout: result.stdout, stderr: result.stderr },
        },
        400,
      );
    }
    return c.json({
      ok: true,
      data: {
        installed: true,
        command: result.command,
        stdout: result.stdout,
        serverName: info.serverName,
      },
    });
  } catch (err) {
    return c.json({ ok: false, error: publicErrorMessage(err, 'codex install failed') }, 500);
  }
});

// DELETE /api/mcp/install/codex
mcpExpose.delete('/install/codex', async (c) => {
  try {
    const runner = codexRunnerOverride ?? undefined;
    const result = await uninstallCodexMcp(runner);
    if (!result.ok) {
      return c.json(
        {
          ok: false,
          error: result.stderr || result.stdout || 'codex mcp remove failed',
          data: { stdout: result.stdout, stderr: result.stderr },
        },
        400,
      );
    }
    return c.json({ ok: true, data: { removed: true, stdout: result.stdout } });
  } catch (err) {
    return c.json({ ok: false, error: publicErrorMessage(err, 'codex uninstall failed') }, 500);
  }
});

export { mcpExpose };
export default mcpExpose;
