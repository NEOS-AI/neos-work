/**
 * Spawn any coding-agent CLI registered in @neos-work/agent-runtime (v0.5.4).
 * Uses launch policies + settingKey path overrides; streams stdout/stderr.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import {
  AGENT_CLI_DEFS,
  buildLaunchArgs,
  getDefById,
  type PathOverrides,
} from '@neos-work/agent-runtime';
import { getSetting } from '../db/settings.js';
import {
  buildNeosCliEnv,
  ensureCliWorkspace,
  loadMcpTokenEnvVars,
  CLI_PROMPT_MAX_CHARS,
  type SpawnCliAgentResult,
} from './cli-agents.js';

const MAX_CLI_OUTPUT_CHARS = 2 * 1024 * 1024;

function hasUnsafeControlChars(value: string): boolean {
  return /[\0\r\n]/.test(value);
}

export interface SpawnRegistryAgentOptions {
  agentId: string;
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
  onChunk?: (chunk: string, accumulated: string) => void;
  projectId?: string;
  workflowId?: string;
  runId?: string;
  serverUrl?: string;
  authToken?: string;
}

function loadOverrideForAgent(agentId: string): string | undefined {
  const def = getDefById(agentId);
  if (!def) return undefined;
  const raw = getSetting(def.settingKey);
  if (typeof raw !== 'string' || !raw || hasUnsafeControlChars(raw)) return undefined;
  const override = raw.trim();
  if (!override) return undefined;
  try {
    fs.accessSync(override, fs.constants.X_OK);
    return override;
  } catch {
    return undefined;
  }
}

export function loadAllPathOverrides(): PathOverrides {
  const out: PathOverrides = {};
  for (const def of AGENT_CLI_DEFS) {
    const raw = getSetting(def.settingKey);
    if (typeof raw !== 'string' || !raw || hasUnsafeControlChars(raw)) continue;
    const v = raw.trim();
    if (v) out[def.id] = v;
  }
  return out;
}

/**
 * Spawn a registry CLI agent. Rejects if agentId unknown.
 */
export async function spawnRegistryAgent(
  opts: SpawnRegistryAgentOptions,
): Promise<SpawnCliAgentResult> {
  const def = getDefById(opts.agentId);
  if (!def) {
    return Promise.reject(new Error(`Unknown agent id: ${opts.agentId}`));
  }

  if (typeof opts.prompt === 'string' && /\0/.test(opts.prompt)) {
    return Promise.reject(new Error('prompt contains invalid control characters'));
  }
  let prompt = typeof opts.prompt === 'string' ? opts.prompt.trim() : '';
  if (!prompt) return Promise.reject(new Error('prompt is required'));
  if (prompt.length > CLI_PROMPT_MAX_CHARS) {
    prompt = prompt.slice(0, CLI_PROMPT_MAX_CHARS) + '\n…[prompt truncated]';
  }

  const binOverride = loadOverrideForAgent(opts.agentId);
  const launch = buildLaunchArgs(def, prompt, binOverride);

  const safeOpt = (raw: unknown, max: number): string | undefined => {
    if (typeof raw !== 'string') return undefined;
    if (hasUnsafeControlChars(raw)) return undefined;
    const s = raw.trim();
    if (!s || s.length > max) return undefined;
    return s;
  };

  const runId = safeOpt(opts.runId, 100);
  const workflowId = safeOpt(opts.workflowId, 100);
  const projectId = safeOpt(opts.projectId, 100);
  const serverUrl = safeOpt(opts.serverUrl, 2_048);
  const authToken = safeOpt(opts.authToken, 8_192);

  if (typeof opts.cwd === 'string' && hasUnsafeControlChars(opts.cwd)) {
    return Promise.reject(new Error('cwd contains invalid control characters'));
  }
  let cwd = typeof opts.cwd === 'string' ? opts.cwd.trim() || undefined : opts.cwd;
  if (cwd) {
    try {
      const st = fs.statSync(cwd);
      if (!st.isDirectory()) return Promise.reject(new Error('cwd is not a directory'));
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

  const mcpTokenEnv = loadMcpTokenEnvVars();
  const neosEnv = buildNeosCliEnv({ workflowId, runId, serverUrl, authToken });
  if (projectId) {
    neosEnv.NEOS_PROJECT_ID = projectId;
    neosEnv.NEOS_PROJECT_DIR = cwd;
  }

  const signal = opts.signal;
  const onChunk = opts.onChunk;

  return new Promise<SpawnCliAgentResult>((resolve, reject) => {
    const stdio: ['pipe' | 'ignore', 'pipe', 'pipe'] =
      launch.mode === 'stdin' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'];

    const child = spawn(launch.bin, launch.args, {
      cwd,
      stdio,
      env: { ...process.env, ...mcpTokenEnv, ...neosEnv },
    });

    if (launch.mode === 'stdin' && launch.stdinPayload != null && child.stdin) {
      child.stdin.write(launch.stdinPayload);
      child.stdin.end();
    }

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
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      const killTimeout = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }, 3000);
      child.once('exit', () => clearTimeout(killTimeout));
    };

    if (signal) {
      if (signal.aborted) handleAbort();
      else signal.addEventListener('abort', handleAbort, { once: true });
    }

    child.stdout?.on('data', (buf: Buffer) => appendChunk(buf.toString('utf8')));
    child.stderr?.on('data', (buf: Buffer) => appendChunk(buf.toString('utf8')));

    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', handleAbort);
      reject(err);
    });

    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', handleAbort);
      if (aborted) {
        resolve({ output: accumulated, exitCode: code });
        return;
      }
      resolve({ output: accumulated, exitCode: code });
    });
  });
}

/** True when agentId is one of the legacy three spawnCliAgent ids. */
export function isLegacyCliId(
  id: string,
): id is 'cli-claude' | 'cli-gemini' | 'cli-codex' {
  return id === 'cli-claude' || id === 'cli-gemini' || id === 'cli-codex';
}
