/**
 * CLI agent detection and spawn utilities.
 * Supports: claude (Claude Code CLI), gemini (Gemini CLI), codex (OpenAI Codex CLI).
 */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CliAgentInfo {
  id: 'cli-claude' | 'cli-gemini' | 'cli-codex';
  name: string;
  path: string;
  version?: string;
}

async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [cmd], { timeout: 3000 });
    // which should return a single path line; drop control-char paths
    const line = stdout.replace(/\0/g, '').split('\n')[0] ?? '';
    if (!line || /[\r\n]/.test(line)) return null;
    const p = line.trim();
    if (!p || /[\0\r\n]/.test(p)) return null;
    return p;
  } catch {
    return null;
  }
}

async function getVersion(binPath: string, versionFlag = '--version'): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(binPath, [versionFlag], { timeout: 3000 });
    // First line only; scrub null bytes for UI/list hygiene
    const line = (stdout.replace(/\0/g, '').split('\n')[0] ?? '').trim();
    if (!line || line.length > 200) return undefined;
    return line;
  } catch {
    return undefined;
  }
}

/** Settings keys for optional manual binary paths (plan Task 3). */
export const CLI_PATH_SETTING_KEYS = {
  'cli-claude': 'CLI_PATH_CLAUDE',
  'cli-gemini': 'CLI_PATH_GEMINI',
  'cli-codex': 'CLI_PATH_CODEX',
} as const;

export type CliPathOverrides = Partial<Record<'cli-claude' | 'cli-gemini' | 'cli-codex', string>>;

/**
 * Resolve a binary path: override if it exists on disk, else PATH lookup.
 */
async function resolveCliPath(
  id: 'cli-claude' | 'cli-gemini' | 'cli-codex',
  defaultBinary: string,
  overrides?: CliPathOverrides,
): Promise<string | null> {
  const overrideRaw = overrides?.[id];
  // Control-char check before trim (settings override hygiene)
  if (typeof overrideRaw === 'string' && !/[\0\r\n]/.test(overrideRaw)) {
    const override = overrideRaw.trim();
    if (override && override.length <= 1_024) {
      try {
        fs.accessSync(override, fs.constants.X_OK);
        return override;
      } catch {
        // fall through to PATH
      }
    }
  }
  return which(defaultBinary);
}

/** Detect available CLI agents on the host system (optional manual path overrides). */
export async function detectCLIs(overrides?: CliPathOverrides): Promise<CliAgentInfo[]> {
  const results: CliAgentInfo[] = [];

  const claudePath = await resolveCliPath('cli-claude', 'claude', overrides);
  if (claudePath) {
    const version = await getVersion(claudePath);
    results.push({ id: 'cli-claude', name: 'Claude Code', path: claudePath, version });
  }

  const geminiPath = await resolveCliPath('cli-gemini', 'gemini', overrides);
  if (geminiPath) {
    const version = await getVersion(geminiPath);
    results.push({ id: 'cli-gemini', name: 'Gemini CLI', path: geminiPath, version });
  }

  const codexPath = await resolveCliPath('cli-codex', 'codex', overrides);
  if (codexPath) {
    const version = await getVersion(codexPath);
    results.push({ id: 'cli-codex', name: 'Codex CLI', path: codexPath, version });
  }

  return results;
}

export interface SpawnCliAgentOptions {
  cliId: 'cli-claude' | 'cli-gemini' | 'cli-codex';
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
  onChunk?: (chunk: string, accumulated: string) => void;
  /** Plan Task 3 — injected into child env as NEOS_* variables */
  workflowId?: string;
  runId?: string;
  serverUrl?: string;
  authToken?: string;
}

export interface SpawnCliAgentResult {
  output: string;
  exitCode: number | null;
}

/**
 * Build CLI arguments for the given agent.
 * Each CLI has a different interface for non-interactive prompt submission.
 */
export function buildCliArgs(
  cliId: SpawnCliAgentOptions['cliId'],
  prompt: string,
  binOverride?: string,
): { bin: string; args: string[] } {
  switch (cliId) {
    case 'cli-claude':
      // claude --print "<prompt>" (non-interactive mode)
      return { bin: binOverride ?? 'claude', args: ['--print', prompt] };
    case 'cli-gemini':
      // gemini -p "<prompt>"
      return { bin: binOverride ?? 'gemini', args: ['-p', prompt] };
    case 'cli-codex':
      // codex exec "<prompt>"
      return { bin: binOverride ?? 'codex', args: ['exec', prompt] };
  }
}

/** Load all stored MCP OAuth tokens and return them as env var entries. */
export function loadMcpTokenEnvVars(): Record<string, string> {
  const tokenDir = path.join(os.homedir(), '.config', 'neos-work', 'mcp-tokens');
  const envVars: Record<string, string> = {};
  try {
    const files = fs.readdirSync(tokenDir);
    for (const file of files) {
      // Skip non-json and hidden files (e.g. .backup.json)
      if (!file.endsWith('.json') || file.startsWith('.')) continue;
      try {
        const abs = path.join(tokenDir, file);
        // Skip planted symlinks (do not follow into outside token dumps)
        const st = fs.lstatSync(abs);
        if (st.isSymbolicLink() || !st.isFile()) continue;
        const raw = fs.readFileSync(abs, 'utf-8');
        const token = JSON.parse(raw) as { serverId: string; accessToken: string; expiresAt?: string };
        const serverIdRaw = typeof token.serverId === 'string' ? token.serverId : '';
        const accessTokenRaw = typeof token.accessToken === 'string' ? token.accessToken : '';
        // Control-char check before trim
        if (!serverIdRaw || !accessTokenRaw || /[\0\r\n]/.test(serverIdRaw) || /[\0\r\n]/.test(accessTokenRaw)) {
          continue;
        }
        const serverId = serverIdRaw.trim();
        const accessToken = accessTokenRaw.trim();
        if (!serverId || !accessToken || serverId.length > 200 || accessToken.length > 16_384) continue;
        // Skip expired tokens
        if (token.expiresAt && new Date(token.expiresAt) <= new Date()) continue;
        const key = `NEOS_MCP_TOKEN_${serverId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
        envVars[key] = accessToken;
      } catch {
        // Ignore malformed files
      }
    }
  } catch {
    // Token dir doesn't exist — no tokens to inject
  }
  return envVars;
}

/** Reject null bytes / CR / LF that confuse shell path APIs. */
function hasUnsafeControlChars(value: string): boolean {
  return /[\0\r\n]/.test(value);
}

/**
 * Build NEOS_* context env vars for CLI child processes (plan Task 3).
 * Exported for unit tests.
 */
/** http(s) only — keeps file:/javascript: out of child env. */
function isHttpServerUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildNeosCliEnv(opts: {
  workflowId?: string;
  runId?: string;
  serverUrl?: string;
  authToken?: string;
}): Record<string, string> {
  const env: Record<string, string> = {};
  const safeField = (raw: unknown, max: number): string => {
    if (typeof raw !== 'string') return '';
    // Control-char check before trim
    if (hasUnsafeControlChars(raw)) return '';
    const s = raw.trim();
    if (!s || s.length > max) return '';
    return s;
  };
  const serverUrlRaw = safeField(opts.serverUrl, 2_048);
  // Only forward http(s) URLs to children (block file:/javascript: etc.)
  const serverUrl =
    serverUrlRaw && isHttpServerUrl(serverUrlRaw) ? serverUrlRaw.replace(/\/+$/, '') : '';
  const authToken = safeField(opts.authToken, 8_192);
  const workflowId = safeField(opts.workflowId, 100);
  const runId = safeField(opts.runId, 100);
  if (serverUrl) env.NEOS_SERVER_URL = serverUrl;
  if (authToken) env.NEOS_AUTH_TOKEN = authToken;
  if (workflowId) env.NEOS_WORKFLOW_ID = workflowId;
  if (runId) env.NEOS_RUN_ID = runId;
  return env;
}

/**
 * Ensure a per-run workspace directory exists under
 * `~/.config/neos-work/workspaces/<runId>/` (plan Task 3).
 * runId is sanitized to block path traversal.
 */
export function ensureCliWorkspace(runId: string): string {
  if (typeof runId !== 'string' || hasUnsafeControlChars(runId)) {
    throw new Error('Invalid runId');
  }
  const trimmed = runId.trim();
  if (!trimmed || trimmed.length > 100) throw new Error('Invalid runId');
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!safe) throw new Error('Invalid runId');
  const base = path.join(os.homedir(), '.config', 'neos-work', 'workspaces');
  const dir = path.join(base, safe);
  // Defence in depth: resolved path must stay under workspaces root
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(base) + path.sep) && resolved !== path.resolve(base)) {
    throw new Error('Invalid runId');
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Cap CLI stream accumulation (plan Task 3 — runaway output defense). */
const MAX_CLI_OUTPUT_CHARS = 2 * 1024 * 1024;

/** Spawn a CLI agent and stream output via onChunk. Respects AbortSignal. */
/** Cap CLI agent prompt size (system + inputs already bounded upstream). */
export const CLI_PROMPT_MAX_CHARS = 400_000;

export async function spawnCliAgent(opts: SpawnCliAgentOptions): Promise<SpawnCliAgentResult> {
  const cliId = opts.cliId;
  // Control-char check before trim on prompt
  if (typeof opts.prompt === 'string' && hasUnsafeControlChars(opts.prompt)) {
    return Promise.reject(new Error('prompt contains invalid control characters'));
  }
  let prompt = typeof opts.prompt === 'string' ? opts.prompt.trim() : '';
  if (!prompt) {
    return Promise.reject(new Error('prompt is required'));
  }
  if (prompt.length > CLI_PROMPT_MAX_CHARS) {
    prompt = prompt.slice(0, CLI_PROMPT_MAX_CHARS) + '\n…[prompt truncated]';
  }
  const signal = opts.signal;
  const onChunk = opts.onChunk;
  const safeOpt = (raw: unknown, max: number): string | undefined => {
    if (typeof raw !== 'string') return undefined;
    if (hasUnsafeControlChars(raw)) return undefined;
    const s = raw.trim();
    if (!s || s.length > max) return undefined;
    return s;
  };
  const workflowId = safeOpt(opts.workflowId, 100);
  const runId = safeOpt(opts.runId, 100);
  const serverUrl = safeOpt(opts.serverUrl, 2_048);
  const authToken = safeOpt(opts.authToken, 8_192);

  // Resolve optional path override from settings (lazy import avoids circular deps in tests)
  let binOverride: string | undefined;
  try {
    const { getSetting } = await import('../db/settings.js');
    const key = CLI_PATH_SETTING_KEYS[cliId];
    // Control-char check before trim so "\n/bin/claude" is not accepted
    const overrideRaw = getSetting(key);
    if (
      typeof overrideRaw === 'string'
      && overrideRaw
      && !hasUnsafeControlChars(overrideRaw)
    ) {
      const override = overrideRaw.trim();
      if (override) {
        try {
          fs.accessSync(override, fs.constants.X_OK);
          binOverride = override;
        } catch {
          // ignore invalid override
        }
      }
    }
  } catch {
    // settings unavailable
  }

  const { bin, args } = buildCliArgs(cliId, prompt, binOverride);
  const mcpTokenEnv = loadMcpTokenEnvVars();
  const neosEnv = buildNeosCliEnv({ workflowId, runId, serverUrl, authToken });

  // Prefer explicit cwd; otherwise create a per-run workspace when runId is known
  // Check control chars on raw input before trim (trim would strip CR/LF)
  if (typeof opts.cwd === 'string' && hasUnsafeControlChars(opts.cwd)) {
    return Promise.reject(new Error('cwd contains invalid control characters'));
  }
  let cwd = typeof opts.cwd === 'string' ? opts.cwd.trim() || undefined : opts.cwd;
  if (cwd) {
    try {
      // realpath: resolve symlink cwd so spawn cannot run outside intended tree via link
      const real = fs.realpathSync(path.resolve(cwd));
      const st = fs.statSync(real);
      if (!st.isDirectory()) {
        return Promise.reject(new Error('cwd is not a directory'));
      }
      cwd = real;
    } catch (err) {
      if (err instanceof Error && err.message.includes('not a directory')) throw err;
      return Promise.reject(new Error(`cwd does not exist: ${cwd}`));
    }
  }
  if (!cwd && runId) {
    try {
      cwd = ensureCliWorkspace(runId);
    } catch {
      cwd = process.cwd();
    }
  }
  cwd = cwd ?? process.cwd();

  return new Promise<SpawnCliAgentResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...mcpTokenEnv, ...neosEnv },
    });

    let accumulated = '';
    let aborted = false;

    const appendChunk = (chunk: string) => {
      if (accumulated.length < MAX_CLI_OUTPUT_CHARS) {
        const room = MAX_CLI_OUTPUT_CHARS - accumulated.length;
        accumulated += chunk.length > room ? chunk.slice(0, room) : chunk;
      }
      onChunk?.(chunk, accumulated);
    };

    const handleAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
      // SIGKILL after 3s if still running
      const killTimeout = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, 3000);
      child.once('exit', () => clearTimeout(killTimeout));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    child.stdout?.on('data', (data: Buffer) => {
      appendChunk(data.toString('utf8'));
    });

    child.stderr?.on('data', (data: Buffer) => {
      // Stream stderr as progress too (CLI tools often write status to stderr)
      appendChunk(data.toString('utf8'));
    });

    child.on('error', (err) => {
      signal?.removeEventListener('abort', handleAbort);
      reject(err);
    });

    child.on('exit', (code) => {
      signal?.removeEventListener('abort', handleAbort);
      void aborted; // abort still returns accumulated output + exit code
      resolve({ output: accumulated, exitCode: code });
    });
  });
}
