import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import plugins from './plugins.js';

const SKILLS_DIR = path.join(os.homedir(), '.config', 'neos-work', 'skills');
const DIR_NAME = `_cov_plugin_route_${process.pid}`;
const DIR = path.join(SKILLS_DIR, DIR_NAME);

afterEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true }).catch(() => {});
});

describe('plugins routes', () => {
  it('lists plugins as ok data array', async () => {
    const res = await plugins.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns 404 for unknown plugin', async () => {
    const res = await plugins.request('/no-such-plugin-xyz');
    expect(res.status).toBe(404);
  });

  it('rejects upgrade without skillId/skillDirName', async () => {
    const res = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('upgrades skill dir to plugin and returns detail', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      '---\nname: Cov Route Plugin\n---\n\n# Cov\n\nBody.\n',
      'utf8',
    );

    const up = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillDirName: DIR_NAME,
        name: 'Cov Route Plugin',
        description: 'from test',
      }),
    });
    expect(up.status).toBe(201);
    const created = await up.json() as { ok: boolean; data: { id: string; name: string; pipeline?: unknown[] } };
    expect(created.ok).toBe(true);
    expect(created.data.id).toBe(DIR_NAME);
    expect(created.data.pipeline?.length).toBe(4);

    const get = await plugins.request(`/${DIR_NAME}`);
    expect(get.status).toBe(200);
    const detail = await get.json() as { data: { name: string; skillContent?: string } };
    expect(detail.data.name).toBe('Cov Route Plugin');
    // list view should not require skillContent
    const list = await plugins.request('/');
    const listBody = await list.json() as { data: Array<{ id: string; skillContent?: string }> };
    const row = listBody.data.find((p) => p.id === DIR_NAME);
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty('skillContent');
  });
});
