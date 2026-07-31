import { describe, expect, it } from 'vitest';
import { buildAgentEnv, formatAgentEnvExports } from './env-inject.js';
import type { CliConfig } from './config.js';

const base: CliConfig = {
  serverUrl: 'http://127.0.0.1:3000',
  authToken: 'tok',
  projectId: 'proj',
  projectDir: '/tmp/p',
  timeoutMs: 30_000,
};

describe('buildAgentEnv', () => {
  it('includes core keys and formats exports', () => {
    const env = buildAgentEnv(base, { binPath: '/usr/local/bin/neos' });
    expect(env.NEOS_SERVER_URL).toBe(base.serverUrl);
    expect(env.NEOS_AUTH_TOKEN).toBe('tok');
    expect(env.NEOS_PROJECT_ID).toBe('proj');
    expect(env.NEOS_BIN).toBe('/usr/local/bin/neos');
    const sh = formatAgentEnvExports(env);
    expect(sh).toContain("export NEOS_AUTH_TOKEN='tok'");
  });
});
