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
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getVersion(binPath: string, versionFlag = '--version'): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(binPath, [versionFlag], { timeout: 3000 });
    return stdout.trim().split('\n')[0];
  } catch {
    return undefined;
  }
}

/** Detect available CLI agents on the host system. */
export async function detectCLIs(): Promise<CliAgentInfo[]> {
  const results: CliAgentInfo[] = [];

  const claudePath = await which('claude');
  if (claudePath) {
    const version = await getVersion(claudePath);
    results.push({ id: 'cli-claude', name: 'Claude Code', path: claudePath, version });
  }

  const geminiPath = await which('gemini');
  if (geminiPath) {
    const version = await getVersion(geminiPath);
    results.push({ id: 'cli-gemini', name: 'Gemini CLI', path: geminiPath, version });
  }

  const codexPath = await which('codex');
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
}

export interface SpawnCliAgentResult {
  output: string;
  exitCode: number | null;
}

/**
 * Build CLI arguments for the given agent.
 * Each CLI has a different interface for non-interactive prompt submission.
 */
function buildCliArgs(cliId: SpawnCliAgentOptions['cliId'], prompt: string): { bin: string; args: string[] } {
  switch (cliId) {
    case 'cli-claude':
      // claude --print "<prompt>" (non-interactive mode)
      return { bin: 'claude', args: ['--print', prompt] };
    case 'cli-gemini':
      // gemini -p "<prompt>"
      return { bin: 'gemini', args: ['-p', prompt] };
    case 'cli-codex':
      // codex exec "<prompt>"
      return { bin: 'codex', args: ['exec', prompt] };
  }
}

/** Load all stored MCP OAuth tokens and return them as env var entries. */
function loadMcpTokenEnvVars(): Record<string, string> {
  const tokenDir = path.join(os.homedir(), '.config', 'neos-work', 'mcp-tokens');
  const envVars: Record<string, string> = {};
  try {
    const files = fs.readdirSync(tokenDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(tokenDir, file), 'utf-8');
        const token = JSON.parse(raw) as { serverId: string; accessToken: string; expiresAt?: string };
        if (!token.serverId || !token.accessToken) continue;
        // Skip expired tokens
        if (token.expiresAt && new Date(token.expiresAt) <= new Date()) continue;
        const key = `NEOS_MCP_TOKEN_${token.serverId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
        envVars[key] = token.accessToken;
      } catch {
        // Ignore malformed files
      }
    }
  } catch {
    // Token dir doesn't exist — no tokens to inject
  }
  return envVars;
}

/** Spawn a CLI agent and stream output via onChunk. Respects AbortSignal. */
export async function spawnCliAgent(opts: SpawnCliAgentOptions): Promise<SpawnCliAgentResult> {
  const { cliId, prompt, cwd, signal, onChunk } = opts;
  const { bin, args } = buildCliArgs(cliId, prompt);
  const mcpTokenEnv = loadMcpTokenEnvVars();

  return new Promise<SpawnCliAgentResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...mcpTokenEnv },
    });

    let accumulated = '';
    let aborted = false;

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
      const chunk = data.toString('utf8');
      accumulated += chunk;
      onChunk?.(chunk, accumulated);
    });

    child.stderr?.on('data', (data: Buffer) => {
      // Treat stderr as informational — do not fail the run
      const chunk = data.toString('utf8');
      accumulated += chunk;
    });

    child.on('error', (err) => {
      signal?.removeEventListener('abort', handleAbort);
      reject(err);
    });

    child.on('exit', (code) => {
      signal?.removeEventListener('abort', handleAbort);
      if (aborted) {
        resolve({ output: accumulated, exitCode: code });
      } else if (code !== 0) {
        resolve({ output: accumulated, exitCode: code });
      } else {
        resolve({ output: accumulated, exitCode: code });
      }
    });
  });
}
