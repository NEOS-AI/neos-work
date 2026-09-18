import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { resolveUserSkillsDir } from '@neos-work/core';

import { getDb } from '../db/schema.js';
import { deleteSetting, setSetting } from '../db/settings.js';
import {
  ageSkillsSearchCache,
  auditRemoteSkill,
  computeSkillFolderHash,
  previewRemoteSkill,
  resetSkillsCatalogState,
  searchSkillCatalog,
  setSkillsCatalogFetchImpl,
  SkillsHttpError,
} from './skills-catalog.js';
import {
  FIND_SKILLS_GOLDEN_HASH,
  FIND_SKILLS_ID,
  FIND_SKILLS_SEARCH_HIT,
  FIND_SKILLS_SNAPSHOT,
} from './fixtures/find-skills-snapshot.js';
import {
  FRONTEND_DESIGN_ID,
  FRONTEND_DESIGN_SKILL_MD,
} from './fixtures/frontend-design-skill.js';
import { classifyArchivePath } from './skills-archive.js';
import { makeSkillZip, skillMd } from './fixtures/skill-zip.js';
import { installRemoteSkill } from './skills-install.js';
import { upsertSkill } from '../routes/skills.js';

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

afterEach(async () => {
  resetSkillsCatalogState();
  try { deleteSetting('skills.remoteCatalogEnabled'); } catch { /* ignore */ }
  try { deleteSetting('skills.remoteInstallEnabled'); } catch { /* ignore */ }
  getDb().prepare("DELETE FROM skill WHERE name LIKE 'find-skills%' OR name LIKE '_cat_%' OR name = 'archived'").run();
  await rm(join(resolveUserSkillsDir(), 'archived'), { recursive: true, force: true }).catch(() => {});
});

describe('computeSkillFolderHash / golden fixture', () => {
  it('embeds the live find-skills hash hex and uses the local-lock loop', () => {
    expect(FIND_SKILLS_SNAPSHOT.hash).toBe(FIND_SKILLS_GOLDEN_HASH);
    expect(FIND_SKILLS_GOLDEN_HASH).toBe(
      'b146008599c31057cef1c145774cea5d5afb30e8f43fa802e47a4b461419aaaf',
    );
    const hex = computeSkillFolderHash(
      FIND_SKILLS_SNAPSHOT.files.map((f) => ({ relativePath: f.path, content: f.contents })),
    );
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('searchSkillCatalog', () => {
  it('returns normalized hits on the happy path', async () => {
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      expect(url).toContain('https://skills.sh/api/search?');
      expect(url).toContain('q=find');
      return jsonResponse({
        query: 'find',
        searchType: 'fuzzy',
        count: 1,
        skills: [FIND_SKILLS_SEARCH_HIT],
      });
    }));
    const data = await searchSkillCatalog({ q: 'find', limit: 10 });
    expect(data.count).toBe(1);
    expect(data.skills[0]).toMatchObject({
      id: FIND_SKILLS_ID,
      slug: 'find-skills',
      sourceType: 'github',
      installUrl: 'https://github.com/vercel-labs/skills',
      url: `https://skills.sh/${FIND_SKILLS_ID}`,
      installed: false,
    });
    expect(data.cached).toBeUndefined();
  });

  it('returns count 0 for empty skills array', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({ query: 'zz', searchType: 'fuzzy', skills: [], count: 0 })));
    const data = await searchSkillCatalog({ q: 'zz' });
    expect(data.count).toBe(0);
    expect(data.skills).toEqual([]);
  });

  it('rejects short queries', async () => {
    await expect(searchSkillCatalog({ q: 'a' })).rejects.toMatchObject({
      http: 400,
      code: 'query_too_short',
    });
  });

  it('maps 401 and endpoint 404 to 502 upstream_unavailable without OIDC', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({ error: 'authentication_required' }, 401)));
    await expect(searchSkillCatalog({ q: 'react' })).rejects.toMatchObject({
      http: 502,
      code: 'upstream_unavailable',
    });

    resetSkillsCatalogState();
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({ error: 'not_found' }, 404)));
    await expect(searchSkillCatalog({ q: 'react' })).rejects.toMatchObject({
      http: 502,
      code: 'upstream_unavailable',
    });
  });

  it('serves stale cache after a 5xx', async () => {
    let calls = 0;
    setSkillsCatalogFetchImpl(mockFetch(() => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({ query: 'find', searchType: 'fuzzy', skills: [FIND_SKILLS_SEARCH_HIT], count: 1 });
      }
      return jsonResponse({ error: 'boom' }, 500);
    }));
    await searchSkillCatalog({ q: 'find' });
    ageSkillsSearchCache(46_000);
    const stale = await searchSkillCatalog({ q: 'find' });
    expect(stale.stale).toBe(true);
    expect(stale.skills[0]?.id).toBe(FIND_SKILLS_ID);
  });

  it('returns 403 catalog_disabled when the flag is false', async () => {
    setSetting('skills.remoteCatalogEnabled', 'false');
    await expect(searchSkillCatalog({ q: 'find' })).rejects.toMatchObject({
      http: 403,
      code: 'catalog_disabled',
    });
  });

  it('rejects a present but invalid owner instead of searching unfiltered', async () => {
    await expect(searchSkillCatalog({ q: 'find', owner: 'Not_Valid' })).rejects.toMatchObject({
      http: 400,
      code: 'invalid_id',
    });
    await expect(searchSkillCatalog({ q: 'find', owner: 'bad\nowner' })).rejects.toMatchObject({
      http: 400,
      code: 'invalid_id',
    });
  });
});

describe('previewRemoteSkill', () => {
  it('previews find-skills from a snapshot fixture', async () => {
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      expect(url).toContain('/api/download/vercel-labs/skills/find-skills');
      return jsonResponse(FIND_SKILLS_SNAPSHOT);
    }));
    const data = await previewRemoteSkill({ id: FIND_SKILLS_ID });
    expect(data.fetchPath).toBe('snapshot');
    expect(data.trust).toBe('unverified');
    expect(data.name).toBe('find-skills');
    expect(data.skillMd).toContain('name: find-skills');
    expect(data.hash).toBe(FIND_SKILLS_GOLDEN_HASH);
    expect(data.license).toBe('MIT');
  });

  it('keeps 400 invalid_source for a malformed catalog id', async () => {
    await expect(previewRemoteSkill({ id: 'not-a-github-id' })).rejects.toMatchObject({
      http: 400,
      code: 'invalid_source',
    });
  });

  it('previews frontend-design from mocked raw SKILL.md (not zipball)', async () => {
    const seen: string[] = [];
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      seen.push(url);
      if (url.includes('codeload.github.com') || url.includes('/archive/')) {
        throw new Error('preview must not download a zip');
      }
      if (url.includes('/api/download/')) return jsonResponse({ error: 'not_found' }, 404);
      if (url.includes('raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md')) {
        return new Response(FRONTEND_DESIGN_SKILL_MD, { status: 200 });
      }
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const data = await previewRemoteSkill({ id: FRONTEND_DESIGN_ID });
    expect(data.fetchPath).toBe('direct');
    expect(data.name).toBe('frontend-design');
    expect(data.skillMd).toContain('name: frontend-design');
    expect(seen.some((u) => u.includes('raw.githubusercontent.com'))).toBe(true);
    expect(seen.some((u) => u.includes('codeload.github.com'))).toBe(false);
  });

  it('returns 502 when snapshot and raw SKILL.md are both missing', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({ error: 'not_found' }, 404)));
    await expect(previewRemoteSkill({ id: FRONTEND_DESIGN_ID })).rejects.toMatchObject({
      http: 502,
      code: 'upstream_unavailable',
    });
  });
});

describe('well-known + zipball resolve', () => {
  it('does not fall back to origin index for a scoped well-known URL', async () => {
    const seen: string[] = [];
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      seen.push(url);
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    await expect(
      previewRemoteSkill({ url: 'https://skills.example.com/s/team' }),
    ).rejects.toMatchObject({ http: 404, code: 'no_skills' });
    expect(seen.some((u) => u === 'https://skills.example.com/.well-known/agent-skills/index.json')).toBe(false);
    expect(seen.some((u) => u === 'https://skills.example.com/.well-known/skills/index.json')).toBe(false);
    expect(seen.some((u) => u.includes('/s/team/.well-known/'))).toBe(true);
  });

  it('accepts v0.2.0 type:archive when digest matches and rejects mismatch', async () => {
    const zip = await makeSkillZip([
      { name: 'pkg/SKILL.md', content: skillMd('archived') },
    ]);
    const digest = `sha256:${createHash('sha256').update(zip).digest('hex')}`;
    const index = {
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: [{
        name: 'archived',
        type: 'archive',
        url: 'https://skills.example.com/archived.zip',
        digest,
        description: 'zip skill',
      }],
    };
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.endsWith('/.well-known/agent-skills/index.json')) return jsonResponse(index);
      if (url.endsWith('/archived.zip')) {
        return new Response(zip, { status: 200, headers: { 'content-type': 'application/zip' } });
      }
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    const ok = await previewRemoteSkill({ url: 'https://skills.example.com/' });
    expect(ok.fetchPath).toBe('well-known');
    expect(ok.name).toBe('archived');

    resetSkillsCatalogState();
    const badIndex = {
      ...index,
      skills: [{ ...index.skills[0], digest: `sha256:${'ab'.repeat(32)}` }],
    };
    setSkillsCatalogFetchImpl(mockFetch((url) => {
      if (url.endsWith('/.well-known/agent-skills/index.json')) return jsonResponse(badIndex);
      if (url.endsWith('/archived.zip')) {
        return new Response(zip, { status: 200 });
      }
      return jsonResponse({ error: 'not_found' }, 404);
    }));
    await expect(
      installRemoteSkill(
        { url: 'https://skills.example.com/', confirm: true },
        { upsert: upsertSkill },
      ),
    ).rejects.toMatchObject({ http: 502, code: 'hash_mismatch' });
  });
});

describe('classifyArchivePath (snapshot files)', () => {
  it('rejects . and .. segments', () => {
    expect(classifyArchivePath('.')).toBe('reject');
    expect(classifyArchivePath('foo/.')).toBe('reject');
    expect(classifyArchivePath('../SKILL.md')).toBe('reject');
    expect(classifyArchivePath('SKILL.md')).toBe('ok');
  });
});

describe('auditRemoteSkill', () => {
  it('returns unavailable=true instead of failing when audit is down', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({ error: 'authentication_required' }, 401)));
    const data = await auditRemoteSkill({ id: FIND_SKILLS_ID });
    expect(data).toEqual({ audits: [], unavailable: true });
  });
});
