import { describe, expect, it } from 'vitest';
import cliAgents from './cli-agents.js';
import { CLI_PATH_SETTING_KEYS } from '../lib/cli-agents.js';

describe('cli-agents routes', () => {
  it('GET / returns ok data array and path override meta', async () => {
    const res = await cliAgents.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      data: Array<{ id: string; name: string; path: string }>;
      meta: { settingKeys: Record<string, string>; pathOverrides: Record<string, string> };
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    for (const agent of body.data) {
      expect(agent.id).toMatch(/^cli-/);
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.path.length).toBeGreaterThan(0);
    }
    expect(body.meta.settingKeys).toEqual(CLI_PATH_SETTING_KEYS);
    expect(body.meta.pathOverrides).toBeTypeOf('object');
  });
});
