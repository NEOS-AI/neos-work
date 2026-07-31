/**
 * Agent env injection helpers (Task 11).
 * Export a stable set of env vars coding agents can inherit.
 */

import type { CliConfig } from './config.js';

export interface AgentEnv {
  NEOS_SERVER_URL: string;
  NEOS_AUTH_TOKEN?: string;
  NEOS_PROJECT_ID?: string;
  NEOS_PROJECT_DIR?: string;
  NEOS_BIN?: string;
}

/**
 * Build env map for child agent processes.
 * Does not include undefined values.
 */
export function buildAgentEnv(
  cfg: CliConfig,
  opts?: { binPath?: string; extra?: Record<string, string> },
): Record<string, string> {
  const env: Record<string, string> = {
    NEOS_SERVER_URL: cfg.serverUrl,
  };
  if (cfg.authToken) env.NEOS_AUTH_TOKEN = cfg.authToken;
  if (cfg.projectId) env.NEOS_PROJECT_ID = cfg.projectId;
  if (cfg.projectDir) env.NEOS_PROJECT_DIR = cfg.projectDir;
  if (opts?.binPath && !/[\0\r\n]/.test(opts.binPath) && opts.binPath.trim()) {
    env.NEOS_BIN = opts.binPath.trim();
  }
  if (opts?.extra) {
    for (const [k, v] of Object.entries(opts.extra)) {
      if (typeof k !== 'string' || /[\0\r\n]/.test(k) || !k.trim()) continue;
      if (typeof v !== 'string' || /[\0\r\n]/.test(v)) continue;
      env[k.trim()] = v;
    }
  }
  return env;
}

/** Shell-export lines (secrets included — for local agent launch only). */
export function formatAgentEnvExports(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => {
      const escaped = v.replace(/'/g, `'\\''`);
      return `export ${k}='${escaped}'`;
    })
    .join('\n');
}
