/**
 * Optional Codex CLI helpers for one-click NEOS MCP install (OD §14.4).
 * Spawns `codex mcp add|remove|get` — never edits ~/.codex/config.toml directly.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const CODEX_MCP_NAME = 'neos-work';

export type CodexMcpRunner = (
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string; code: number }>;

const DEFAULT_TIMEOUT_MS = 15_000;

function scrub(s: string, max = 4000): string {
  return s.replace(/[\0]/g, '').slice(0, max);
}

export async function defaultCodexRunner(
  args: string[],
  opts?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('codex', args, {
      timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      env: opts?.env ?? process.env,
      maxBuffer: 256 * 1024,
      encoding: 'utf8',
    });
    return {
      stdout: scrub(String(stdout ?? '')),
      stderr: scrub(String(stderr ?? '')),
      code: 0,
    };
  } catch (err: unknown) {
    const e = err as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
    };
    const code =
      typeof e.code === 'number'
        ? e.code
        : e.code === 'ENOENT'
          ? 127
          : e.killed
            ? 124
            : 1;
    return {
      stdout: scrub(String(e.stdout ?? '')),
      stderr: scrub(String(e.stderr ?? e.message ?? 'codex failed')),
      code,
    };
  }
}

export interface CodexMcpStatus {
  available: boolean;
  installed: boolean;
  codexPath: string | null;
  detail: string | null;
  raw?: string;
}

/**
 * Probe whether Codex CLI is on PATH and whether neos-work MCP is registered.
 */
export async function getCodexMcpStatus(
  runner: CodexMcpRunner = defaultCodexRunner,
): Promise<CodexMcpStatus> {
  // `codex mcp get <name>` — non-zero if missing; ENOENT if codex not installed
  const which = await runner(['--version'], { timeoutMs: 5_000 });
  if (which.code === 127) {
    return {
      available: false,
      installed: false,
      codexPath: null,
      detail: 'codex CLI not found on PATH',
    };
  }
  if (which.code !== 0 && !which.stdout && !which.stderr) {
    return {
      available: false,
      installed: false,
      codexPath: null,
      detail: scrub(which.stderr || 'codex not available'),
    };
  }

  const get = await runner(['mcp', 'get', CODEX_MCP_NAME], { timeoutMs: 8_000 });
  const combined = `${get.stdout}\n${get.stderr}`.toLowerCase();
  const missingPhrase = /not found|unknown|no such|does not exist|missing/i.test(combined);
  const installed =
    get.code === 0
    && !missingPhrase
    && get.stdout.trim().length > 0
    && (combined.includes(CODEX_MCP_NAME) || combined.includes('neos'));

  return {
    available: true,
    installed,
    codexPath: 'codex',
    detail:
      !installed
        ? scrub(get.stderr || get.stdout || 'not installed')
        : get.stdout.trim() || null,
    raw: scrub(`${get.stdout}\n${get.stderr}`.trim(), 2000) || undefined,
  };
}

export interface CodexMcpInstallInput {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Redact secret env values for API / log display. */
export function redactCodexCommandLine(cmdline: string): string {
  if (typeof cmdline !== 'string' || !cmdline) return '';
  return cmdline
    .replace(/(NEOS_AUTH_TOKEN=)([^\s]+)/g, '$1***')
    .replace(/(--env\s+NEOS_AUTH_TOKEN=)([^\s]+)/g, '$1***')
    .replace(/[\0\r\n]+/g, ' ')
    .slice(0, 2_000);
}

export async function installCodexMcp(
  input: CodexMcpInstallInput,
  runner: CodexMcpRunner = defaultCodexRunner,
): Promise<{ ok: boolean; stdout: string; stderr: string; command: string }> {
  const command = input.command.trim();
  if (!command || /[\0\r\n]/.test(command) || command.length > 4096) {
    return { ok: false, stdout: '', stderr: 'Invalid command', command: '' };
  }
  const args = (input.args ?? [])
    .map((a) => String(a ?? '').trim())
    .filter((a) => a && !/[\0\r\n]/.test(a) && a.length <= 500)
    .slice(0, 20);

  const cliArgs = ['mcp', 'add', CODEX_MCP_NAME];
  for (const [k, v] of Object.entries(input.env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    // Allow longer tokens (daemon auth can be 64+ hex); still cap reasonably
    if (typeof v !== 'string' || /[\0\r\n]/.test(v) || v.length > 8_192) continue;
    cliArgs.push('--env', `${k}=${v}`);
  }
  cliArgs.push('--', command, ...args);

  const result = await runner(cliArgs, { timeoutMs: 20_000 });
  // Never return the raw token-bearing command line to API clients
  return {
    ok: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    command: redactCodexCommandLine(['codex', ...cliArgs].join(' ')),
  };
}

export async function uninstallCodexMcp(
  runner: CodexMcpRunner = defaultCodexRunner,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const result = await runner(['mcp', 'remove', CODEX_MCP_NAME], { timeoutMs: 10_000 });
  return {
    ok: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
