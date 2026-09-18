import { afterEach, describe, expect, it } from 'vitest';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';

import { readSkillProvenance, resolveUserSkillsDir, resolveWorkspaceSkillsDir } from '@neos-work/core';

import { getDb } from '../db/schema.js';
import { createWorkspace, deleteWorkspace } from '../db/sessions.js';
import { deleteSetting, setSetting } from '../db/settings.js';
import { upsertSkill } from '../routes/skills.js';
import { resetSkillsCatalogState, setSkillsCatalogFetchImpl } from './skills-catalog.js';
import { installRemoteSkill, setSkillsRenameForTests, updateRemoteSkill } from './skills-install.js';
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
  setSkillsRenameForTests();
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

  it('409s name_conflict for the same remoteId in another scope', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    await installRemoteSkill({ id: FIND_SKILLS_ID, confirm: true }, { upsert: upsertSkill });

    getDb().prepare('DELETE FROM workspace').run();
    const wsTmp = await mkdtemp(join(tmpdir(), 'neos-ws-skills-'));
    const ws = createWorkspace({ name: `_skills_ws_${process.pid}`, path: wsTmp });
    try {
      await expect(
        installRemoteSkill(
          { id: FIND_SKILLS_ID, confirm: true, scope: 'workspace' },
          { upsert: upsertSkill },
        ),
      ).rejects.toMatchObject({ http: 409, code: 'name_conflict' });
      const globalMd = await readFile(join(resolveUserSkillsDir(), 'find-skills', 'SKILL.md'), 'utf8');
      expect(globalMd).toContain('name: find-skills');
    } finally {
      deleteWorkspace(ws.id);
      await rm(wsTmp, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('update keeps a workspace install in the workspace root', async () => {
    getDb().prepare('DELETE FROM workspace').run();
    const wsTmp = await mkdtemp(join(tmpdir(), 'neos-ws-upd-'));
    const ws = createWorkspace({ name: `_skills_ws_${process.pid}`, path: wsTmp });
    try {
      setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
      const installed = await installRemoteSkill(
        { id: FIND_SKILLS_ID, confirm: true, scope: 'workspace' },
        { upsert: upsertSkill },
      );
      expect(installed.scope).toBe('workspace');
      const wsSkill = join(resolveWorkspaceSkillsDir(wsTmp), 'find-skills');
      expect((await readFile(join(wsSkill, 'SKILL.md'), 'utf8'))).toContain('name: find-skills');

      const sameHash = await updateRemoteSkill(installed.id, { upsert: upsertSkill });
      expect(sameHash.unchanged).toBe(true);
      expect(sameHash.scope).toBe('workspace');

      setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({
        ...FIND_SKILLS_SNAPSHOT,
        hash: 'cc'.repeat(32),
      })));
      const updated = await updateRemoteSkill(installed.id, { upsert: upsertSkill });
      expect(updated.scope).toBe('workspace');
      expect(updated.hash).toBe('cc'.repeat(32));
      expect((await readFile(join(wsSkill, 'SKILL.md'), 'utf8'))).toContain('name: find-skills');
      expect(await readFile(join(resolveUserSkillsDir(), 'find-skills', 'SKILL.md'), 'utf8').catch(() => '')).toBe('');
    } finally {
      deleteWorkspace(ws.id);
      await rm(wsTmp, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('restores bak if rename(tmp, final) fails mid-update', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    await installRemoteSkill({ id: FIND_SKILLS_ID, confirm: true }, { upsert: upsertSkill });
    const dest = join(resolveUserSkillsDir(), 'find-skills');
    await writeFile(join(dest, 'marker.txt'), 'keep-me', 'utf8');

    let renames = 0;
    setSkillsRenameForTests(async (from, to) => {
      renames += 1;
      if (renames === 2) throw new Error('rename tmp->final failed');
      return rename(from, to);
    });
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({
      ...FIND_SKILLS_SNAPSHOT,
      hash: 'dd'.repeat(32),
    })));
    const row = getDb().prepare('SELECT id FROM skill WHERE name = ?').get('find-skills') as { id: string };
    await expect(updateRemoteSkill(row.id, { upsert: upsertSkill })).rejects.toThrow(
      /rename tmp->final failed/,
    );
    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toContain('name: find-skills');
    expect(await readFile(join(dest, 'marker.txt'), 'utf8')).toBe('keep-me');
  });

  it('preserves open-design.json on same_remote update', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    await installRemoteSkill({ id: FIND_SKILLS_ID, confirm: true }, { upsert: upsertSkill });
    const dest = join(resolveUserSkillsDir(), 'find-skills');
    await writeFile(join(dest, 'open-design.json'), '{"schemaVersion":"od-plugin/v1","id":"find-skills"}', 'utf8');

    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({
      ...FIND_SKILLS_SNAPSHOT,
      hash: 'ee'.repeat(32),
    })));
    const row = getDb().prepare('SELECT id FROM skill WHERE name = ?').get('find-skills') as { id: string };
    await updateRemoteSkill(row.id, { upsert: upsertSkill });
    const plugin = await readFile(join(dest, 'open-design.json'), 'utf8');
    expect(plugin).toContain('od-plugin/v1');
    expect(plugin).toContain('find-skills');
    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toContain('name: find-skills');
  });
});
