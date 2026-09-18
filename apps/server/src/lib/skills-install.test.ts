import { afterEach, describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { readSkillProvenance, resolveUserSkillsDir } from '@neos-work/core';

import { getDb } from '../db/schema.js';
import { deleteSetting, setSetting } from '../db/settings.js';
import { upsertSkill } from '../routes/skills.js';
import { resetSkillsCatalogState, setSkillsCatalogFetchImpl } from './skills-catalog.js';
import { installRemoteSkill } from './skills-install.js';
import { SkillsHttpError } from './skills-source.js';
import {
  FIND_SKILLS_GOLDEN_HASH,
  FIND_SKILLS_ID,
  FIND_SKILLS_SNAPSHOT,
} from './fixtures/find-skills-snapshot.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(href);
  }) as typeof fetch;
}

const HOME_SKILLS = join(homedir(), '.config', 'neos-work', 'skills');

afterEach(async () => {
  resetSkillsCatalogState();
  try { deleteSetting('skills.remoteCatalogEnabled'); } catch { /* ignore */ }
  try { deleteSetting('skills.remoteInstallEnabled'); } catch { /* ignore */ }
  getDb().prepare("DELETE FROM skill WHERE name LIKE 'find-skills%' OR name LIKE '_ins_%'").run();
  const root = resolveUserSkillsDir();
  await rm(join(root, 'find-skills'), { recursive: true, force: true }).catch(() => {});
});

describe('installRemoteSkill', () => {
  it('installs find-skills from a snapshot into NEOS_DATA_DIR, not ~/.config', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    const result = await installRemoteSkill(
      { id: FIND_SKILLS_ID, confirm: true },
      { upsert: upsertSkill },
    );
    expect(result.source).toBe('remote');
    expect(result.fetchPath).toBe('snapshot');
    expect(result.name).toBe('find-skills');
    expect(result.hash).toBe(FIND_SKILLS_GOLDEN_HASH);

    const root = resolveUserSkillsDir();
    expect(root.startsWith(process.env.NEOS_DATA_DIR ?? '')).toBe(true);
    expect(root).not.toBe(HOME_SKILLS);
    const md = await readFile(join(root, 'find-skills', 'SKILL.md'), 'utf8');
    expect(md).toContain('name: find-skills');
    const prov = await readSkillProvenance(join(root, 'find-skills'));
    expect(prov?.trust).toBe('unverified');
    expect(prov?.hash).toBe(FIND_SKILLS_GOLDEN_HASH);
    expect(prov?.id).toBe(FIND_SKILLS_ID);
  });

  it('still installs when the snapshot hash does not match the computed digest', async () => {
    const mismatch = { ...FIND_SKILLS_SNAPSHOT, hash: 'aa'.repeat(32) };
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(mismatch)));
    const result = await installRemoteSkill(
      { id: FIND_SKILLS_ID, confirm: true },
      { upsert: upsertSkill },
    );
    expect(result.hash).toBe('aa'.repeat(32));
    const prov = await readSkillProvenance(join(resolveUserSkillsDir(), 'find-skills'));
    expect(prov?.hash).toBe('aa'.repeat(32));
    expect(prov?.trust).toBe('unverified');
  });

  it('returns 422 for github sources without a snapshot (ref or missing blob)', async () => {
    await expect(
      installRemoteSkill(
        { url: 'https://github.com/vercel-labs/skills', confirm: true },
        { upsert: upsertSkill },
      ),
    ).rejects.toMatchObject({ http: 422, code: 'install_source_unsupported' });

    await expect(
      installRemoteSkill(
        { id: FIND_SKILLS_ID, ref: 'main', confirm: true },
        { upsert: upsertSkill },
      ),
    ).rejects.toMatchObject({ http: 422, code: 'install_source_unsupported' });

    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({ error: 'not_found' }, 404)));
    await expect(
      installRemoteSkill(
        { id: 'anthropics/skills/frontend-design', confirm: true },
        { upsert: upsertSkill },
      ),
    ).rejects.toMatchObject({ http: 422, code: 'install_source_unsupported' });
  });

  it('requires confirm:true', async () => {
    await expect(
      installRemoteSkill({ id: FIND_SKILLS_ID }, { upsert: upsertSkill }),
    ).rejects.toBeInstanceOf(SkillsHttpError);
    await expect(
      installRemoteSkill({ id: FIND_SKILLS_ID }, { upsert: upsertSkill }),
    ).rejects.toMatchObject({ http: 400, code: 'confirm_required' });
  });

  it('returns 403 when remote install is disabled', async () => {
    setSetting('skills.remoteInstallEnabled', 'false');
    await expect(
      installRemoteSkill({ id: FIND_SKILLS_ID, confirm: true }, { upsert: upsertSkill }),
    ).rejects.toMatchObject({ http: 403, code: 'install_disabled' });
  });

  it('still attempts install when catalog is disabled (422 or snapshot)', async () => {
    setSetting('skills.remoteCatalogEnabled', 'false');
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    const result = await installRemoteSkill(
      { id: FIND_SKILLS_ID, confirm: true },
      { upsert: upsertSkill },
    );
    expect(result.name).toBe('find-skills');
  });

  it('returns 409 occupied_plugin for a plugin-only destination dir', async () => {
    const dest = join(resolveUserSkillsDir(), 'find-skills');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'open-design.json'), '{"schemaVersion":"od-plugin/v1"}', 'utf8');
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    await expect(
      installRemoteSkill({ id: FIND_SKILLS_ID, confirm: true }, { upsert: upsertSkill }),
    ).rejects.toMatchObject({ http: 409, code: 'occupied_plugin' });
    const plugin = await readFile(join(dest, 'open-design.json'), 'utf8');
    expect(plugin).toContain('od-plugin/v1');
  });
});
