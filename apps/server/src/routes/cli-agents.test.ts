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
    // Expanded catalog keys (legacy three + registry)
    expect(body.meta.settingKeys['cli-claude']).toBe(CLI_PATH_SETTING_KEYS['cli-claude']);
    expect(body.meta.settingKeys['cli-gemini']).toBe(CLI_PATH_SETTING_KEYS['cli-gemini']);
    expect(body.meta.settingKeys['cli-codex']).toBe(CLI_PATH_SETTING_KEYS['cli-codex']);
    expect(body.meta.pathOverrides).toBeTypeOf('object');
    expect((body.meta as { catalogCount?: number }).catalogCount).toBeGreaterThanOrEqual(12);
  });

  it('GET /catalog returns full def list', async () => {
    const res = await cliAgents.request('/catalog');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: unknown[]; meta: { count: number } };
    expect(body.ok).toBe(true);
    expect(body.meta.count).toBeGreaterThanOrEqual(12);
    expect(body.data.length).toBe(body.meta.count);
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

  it('ignores control-char path override settings before trim', async () => {
    fs.writeFileSync(TMP, '#!/bin/sh\necho mock\n', { mode: 0o755 });
    // Leading control char must not strip to a valid path
    setSetting(CLI_PATH_SETTING_KEYS['cli-claude'], `\n${TMP}`);
    setSetting(CLI_PATH_SETTING_KEYS['cli-codex'], `${TMP}\n`);
    setSetting(CLI_PATH_SETTING_KEYS['cli-gemini'], `path\0evil`);

    const res = await cliAgents.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { meta: { pathOverrides: Record<string, string> } };
    expect(body.meta.pathOverrides['cli-claude']).toBeUndefined();
    expect(body.meta.pathOverrides['cli-codex']).toBeUndefined();
    expect(body.meta.pathOverrides['cli-gemini']).toBeUndefined();
  });
});

describe('cli-agents detailed listing', () => {
  it('GET /?detailed=1 returns full detect results including unavailable', async () => {
    const res = await cliAgents.request('/?detailed=1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: Array<{ id: string; available?: boolean; binary?: string }>;
      meta: {
        catalogCount: number;
        settingKeys: Record<string, string>;
        legacySettingKeys?: Record<string, string>;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(12);
    expect(body.meta.catalogCount).toBeGreaterThanOrEqual(12);
    expect(body.meta.settingKeys['cli-claude']).toBeTruthy();
    expect(body.meta.legacySettingKeys?.['cli-claude']).toBeTruthy();
    // detailed includes unavailable agents
    expect(body.data.every((a) => typeof a.id === 'string')).toBe(true);
  });

  it('GET /?all=1 is alias for detailed', async () => {
    const res = await cliAgents.request('/?all=1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBeGreaterThanOrEqual(12);
  });
});
