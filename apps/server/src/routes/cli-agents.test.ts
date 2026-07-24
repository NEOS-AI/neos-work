import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteSetting, setSetting } from '../db/settings.js';
import cliAgents from './cli-agents.js';
import { CLI_PATH_SETTING_KEYS } from '../lib/cli-agents.js';

const TMP = path.join(os.tmpdir(), `neos-cli-cov-${process.pid}`);

afterEach(() => {
  for (const key of Object.values(CLI_PATH_SETTING_KEYS)) {
    try { deleteSetting(key); } catch { /* ignore */ }
  }
  try { fs.unlinkSync(TMP); } catch { /* ignore */ }
});

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

  it('exposes trimmed path overrides in meta when settings are set', async () => {
    fs.writeFileSync(TMP, '#!/bin/sh\necho mock\n', { mode: 0o755 });
    setSetting(CLI_PATH_SETTING_KEYS['cli-claude'], `  ${TMP}  `);

    const res = await cliAgents.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: Array<{ id: string; path: string }>;
      meta: { pathOverrides: Record<string, string> };
    };
    expect(body.meta.pathOverrides['cli-claude']).toBe(TMP);
    // If executable override is accepted, agent path should use it
    const claude = body.data.find((a) => a.id === 'cli-claude');
    if (claude) {
      expect(claude.path).toBe(TMP);
    }
  });

  it('ignores whitespace-only path override settings', async () => {
    setSetting(CLI_PATH_SETTING_KEYS['cli-gemini'], '   ');
    const res = await cliAgents.request('/');
    const body = await res.json() as { meta: { pathOverrides: Record<string, string> } };
    expect(body.meta.pathOverrides['cli-gemini']).toBeUndefined();
  });
});
