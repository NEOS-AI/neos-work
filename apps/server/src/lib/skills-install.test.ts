import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';

import { readSkillProvenance, resolveUserSkillsDir, resolveWorkspaceSkillsDir } from '@neos-work/core';
import { NEOS_VERSION } from '@neos-work/shared';

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
import { makeSkillZip, skillMd } from './fixtures/skill-zip.js';

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
  try { deleteSetting('skills.telemetryOptIn'); } catch { /* ignore */ }
  getDb().prepare("DELETE FROM skill WHERE name LIKE 'find-skills%' OR name LIKE '_ins_%' OR name IN ('rooty','alpha','beta','orphaned','archived','binasset','directy','k15-skill')").run();
  const root = resolveUserSkillsDir();
  for (const dir of ['find-skills', 'rooty', 'alpha', 'beta', 'orphaned', 'archived', 'binasset', 'directy', 'k15-skill']) {
    await rm(join(root, dir), { recursive: true, force: true }).catch(() => {});
  }
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

  it('prefers snapshot when present and does not hit zipball', async () => {
    const seen: string[] = [];
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      seen.push(url);
      if (url.includes('codeload.github.com')) throw new Error('zipball should not run');
      return jsonResponse(FIND_SKILLS_SNAPSHOT);
    }));
    const result = await installRemoteSkill(
      { id: FIND_SKILLS_ID, confirm: true },
      { upsert: upsertSkill },
    );
    expect(result.fetchPath).toBe('snapshot');
    expect(seen.some((u) => u.includes('/api/download/'))).toBe(true);
    expect(seen.some((u) => u.includes('codeload.github.com'))).toBe(false);
  });

  it('falls back to zipball when snapshot is missing', async () => {
    const zip = await makeSkillZip([
      { name: 'repo-main/skills/find-skills/SKILL.md', content: FIND_SKILLS_SNAPSHOT.files[0]!.contents },
    ]);
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.includes('/api/download/')) return jsonResponse({ error: 'not_found' }, 404);
      if (url === 'https://codeload.github.com/vercel-labs/skills/zip/main') {
        return new Response(zip, { status: 200 });
      }
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const result = await installRemoteSkill(
      { id: FIND_SKILLS_ID, confirm: true },
      { upsert: upsertSkill },
    );
    expect(result.fetchPath).toBe('zipball');
    expect(result.name).toBe('find-skills');
  });

  it('skips snapshot and uses zipball when ref is explicit', async () => {
    const zip = await makeSkillZip([
      { name: 'repo/skills/find-skills/SKILL.md', content: FIND_SKILLS_SNAPSHOT.files[0]!.contents },
    ]);
    const seen: string[] = [];
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      seen.push(url);
      if (url.includes('/api/download/')) throw new Error('explicit ref must skip snapshot');
      if (url.includes('/zip/v1.2.3')) return new Response(zip, { status: 200 });
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const result = await installRemoteSkill(
      { id: FIND_SKILLS_ID, ref: 'v1.2.3', confirm: true },
      { upsert: upsertSkill },
    );
    expect(result.fetchPath).toBe('zipball');
    expect(seen.some((u) => u.includes('/api/download/'))).toBe(false);
  });

  it('tries master after main 404 for zipball', async () => {
    const zip = await makeSkillZip([
      { name: 'repo/skills/find-skills/SKILL.md', content: FIND_SKILLS_SNAPSHOT.files[0]!.contents },
    ]);
    const seen: string[] = [];
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      seen.push(url);
      if (url.includes('/api/download/')) return jsonResponse({ error: 'not_found' }, 404);
      if (url.endsWith('/zip/main')) return new Response('missing', { status: 404 });
      if (url.endsWith('/zip/master')) return new Response(zip, { status: 200 });
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const result = await installRemoteSkill(
      { id: FIND_SKILLS_ID, confirm: true },
      { upsert: upsertSkill },
    );
    expect(result.fetchPath).toBe('zipball');
    expect(seen.some((u) => u.endsWith('/zip/main'))).toBe(true);
    expect(seen.some((u) => u.endsWith('/zip/master'))).toBe(true);
  });

  it('returns 502 upstream_too_large when zipball Content-Length exceeds the cap', async () => {
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.includes('/api/download/')) return jsonResponse({ error: 'not_found' }, 404);
      if (url.includes('codeload.github.com')) {
        return new Response('x', {
          status: 200,
          headers: { 'content-length': String(11 * 1024 * 1024) },
        });
      }
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    await expect(
      installRemoteSkill({ id: FIND_SKILLS_ID, confirm: true }, { upsert: upsertSkill }),
    ).rejects.toMatchObject({ http: 502, code: 'upstream_too_large' });
  });

  it('copies only the root SKILL.md whitelist', async () => {
    const zip = await makeSkillZip([
      { name: 'repo/SKILL.md', content: skillMd('rooty') },
      { name: 'repo/LICENSE', content: 'MIT' },
      { name: 'repo/README.md', content: 'readme' },
      { name: 'repo/references/note.md', content: 'note' },
      { name: 'repo/.git/config', content: 'git' },
    ]);
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.includes('codeload.github.com')) return new Response(zip, { status: 200 });
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const result = await installRemoteSkill(
      { url: 'https://github.com/acme/root-skill', confirm: true },
      { upsert: upsertSkill },
    );
    expect(result.name).toBe('rooty');
    const dest = join(resolveUserSkillsDir(), 'rooty');
    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toContain('name: rooty');
    expect(await readFile(join(dest, 'references', 'note.md'), 'utf8')).toBe('note');
    await expect(readFile(join(dest, 'LICENSE'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(dest, 'README.md'), 'utf8')).rejects.toThrow();
  });

  it('returns 400 skill_ambiguous with candidates when N skills and no slug', async () => {
    const zip = await makeSkillZip([
      { name: 'repo/skills/alpha/SKILL.md', content: skillMd('alpha') },
      { name: 'repo/skills/beta/SKILL.md', content: skillMd('beta') },
    ]);
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.includes('codeload.github.com')) return new Response(zip, { status: 200 });
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    try {
      await installRemoteSkill(
        { url: 'https://github.com/acme/multi', confirm: true },
        { upsert: upsertSkill },
      );
      expect.unreachable('should be ambiguous');
    } catch (err) {
      expect(err).toMatchObject({ http: 400, code: 'skill_ambiguous' });
      const extra = (err as SkillsHttpError).extra as { candidates: Array<{ slug: string }> };
      expect(extra.candidates.map((c) => c.slug).sort()).toEqual(['alpha', 'beta']);
    }
  });

  it('reuses an orphan destination directory', async () => {
    const dest = join(resolveUserSkillsDir(), 'find-skills');
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, '.scratch'), 'leftover', 'utf8');
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    const result = await installRemoteSkill(
      { id: FIND_SKILLS_ID, confirm: true },
      { upsert: upsertSkill },
    );
    expect(result.name).toBe('find-skills');
    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toContain('name: find-skills');
  });

  it('keeps zip asset bytes intact (no UTF-8 smash)', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8, 0x00, 0x80]);
    const zip = await makeSkillZip([
      { name: 'repo/SKILL.md', content: skillMd('binasset') },
      { name: 'repo/assets/icon.bin', content: png },
    ]);
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.includes('codeload.github.com')) return new Response(zip, { status: 200 });
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const result = await installRemoteSkill(
      { url: 'https://github.com/acme/bin-skill', confirm: true },
      { upsert: upsertSkill },
    );
    expect(result.name).toBe('binasset');
    const written = await readFile(join(resolveUserSkillsDir(), 'binasset', 'assets', 'icon.bin'));
    expect(written.equals(png)).toBe(true);
  });

  it('updates a well-known install by re-parsing the sidecar URL id', async () => {
    const md = skillMd('archived');
    const digest = `sha256:${createHash('sha256').update(md).digest('hex')}`;
    const index = {
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: [{
        name: 'archived',
        type: 'skill-md',
        url: 'https://skills.example.com/archived/SKILL.md',
        digest,
        description: 'wk',
      }],
    };
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.endsWith('/.well-known/agent-skills/index.json')) return jsonResponse(index);
      if (url.endsWith('/archived/SKILL.md')) return new Response(md, { status: 200 });
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const installed = await installRemoteSkill(
      { url: 'https://skills.example.com/', confirm: true },
      { upsert: upsertSkill },
    );
    expect(installed.fetchPath).toBe('well-known');
    const updated = await updateRemoteSkill(installed.id, { upsert: upsertSkill });
    expect(updated.unchanged).toBe(true);
    expect(updated.fetchPath).toBe('well-known');
  });

  it('updates a direct SKILL.md install by re-parsing the sidecar URL id', async () => {
    const md = skillMd('directy');
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url === 'https://example.com/pkg/SKILL.md') return new Response(md, { status: 200 });
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const installed = await installRemoteSkill(
      { url: 'https://example.com/pkg/SKILL.md', confirm: true },
      { upsert: upsertSkill },
    );
    expect(installed.fetchPath).toBe('direct');
    const updated = await updateRemoteSkill(installed.id, { upsert: upsertSkill });
    expect(updated.name).toBe('directy');
    expect(updated.fetchPath).toBe('direct');
  });

  it('restores bak when upsert throws mid-update', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse(FIND_SKILLS_SNAPSHOT)));
    await installRemoteSkill({ id: FIND_SKILLS_ID, confirm: true }, { upsert: upsertSkill });
    const dest = join(resolveUserSkillsDir(), 'find-skills');
    const before = await readFile(join(dest, 'SKILL.md'), 'utf8');

    let calls = 0;
    const throwingUpsert: typeof upsertSkill = (params) => {
      calls += 1;
      if (calls > 0) throw new Error('upsert exploded');
      return upsertSkill(params);
    };
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({
      ...FIND_SKILLS_SNAPSHOT,
      hash: 'ff'.repeat(32),
      files: [{ path: 'SKILL.md', contents: `${before}\n# changed\n` }],
    })));
    const row = getDb().prepare('SELECT id FROM skill WHERE name = ?').get('find-skills') as { id: string };
    await expect(updateRemoteSkill(row.id, { upsert: throwingUpsert })).rejects.toThrow(/upsert exploded/);
    expect(await readFile(join(dest, 'SKILL.md'), 'utf8')).toBe(before);
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

  it('still attempts install when catalog is disabled', async () => {
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

  it('stores owner/repo/slug remoteId when GitHub source omitted the slug', async () => {
    const zip = await makeSkillZip([
      { name: 'repo/skills/k15-skill/SKILL.md', content: skillMd('k15-skill') },
    ]);
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.includes('codeload.github.com')) return new Response(zip, { status: 200 });
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    await installRemoteSkill(
      { id: 'acme/k15-repo', confirm: true },
      { upsert: upsertSkill },
    );
    const dest = join(resolveUserSkillsDir(), 'k15-skill');
    const prov = await readSkillProvenance(dest);
    expect(prov?.id).toBe('acme/k15-repo/k15-skill');
    expect(prov?.slug).toBe('k15-skill');
    expect(prov?.source).toBe('acme/k15-repo');

    const again = await installRemoteSkill(
      { id: 'acme/k15-repo/k15-skill', confirm: true },
      { upsert: upsertSkill },
    );
    expect(again.name).toBe('k15-skill');
    expect((await readSkillProvenance(dest))?.id).toBe('acme/k15-repo/k15-skill');
  });

  it('sends allowlisted telemetry after install only when opted in', async () => {
    const telemetryUrls: string[] = [];
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.startsWith('https://add-skill.vercel.sh/t')) {
        telemetryUrls.push(url);
        return new Response('', { status: 204 });
      }
      return jsonResponse(FIND_SKILLS_SNAPSHOT);
    }));

    await installRemoteSkill({ id: FIND_SKILLS_ID, confirm: true }, { upsert: upsertSkill });
    await Promise.resolve();
    expect(telemetryUrls).toEqual([]);

    setSetting('skills.telemetryOptIn', 'true');
    getDb().prepare("DELETE FROM skill WHERE name = 'find-skills'").run();
    await rm(join(resolveUserSkillsDir(), 'find-skills'), { recursive: true, force: true });

    await installRemoteSkill({ id: FIND_SKILLS_ID, confirm: true }, { upsert: upsertSkill });
    await vi.waitFor(() => expect(telemetryUrls).toHaveLength(1));
    const sent = new URL(telemetryUrls[0]!);
    expect(sent.origin + sent.pathname).toBe('https://add-skill.vercel.sh/t');
    expect([...sent.searchParams.keys()].sort()).toEqual(['event', 'skills', 'source', 'v']);
    expect(sent.searchParams.get('event')).toBe('install');
    expect(sent.searchParams.get('source')).toBe('vercel-labs/skills');
    expect(sent.searchParams.get('skills')).toBe('find-skills');
    expect(sent.searchParams.get('v')).toBe(NEOS_VERSION);

    const unchanged = await updateRemoteSkill(
      (getDb().prepare('SELECT id FROM skill WHERE name = ?').get('find-skills') as { id: string }).id,
      { upsert: upsertSkill },
    );
    expect(unchanged.unchanged).toBe(true);
    await Promise.resolve();
    expect(telemetryUrls).toHaveLength(1);
  });

  it('still installs when opted-in telemetry fetch fails', async () => {
    setSetting('skills.telemetryOptIn', 'true');
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.startsWith('https://add-skill.vercel.sh/t')) throw new Error('telemetry down');
      return jsonResponse(FIND_SKILLS_SNAPSHOT);
    }));
    const result = await installRemoteSkill(
      { id: FIND_SKILLS_ID, confirm: true },
      { upsert: upsertSkill },
    );
    expect(result.name).toBe('find-skills');
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
