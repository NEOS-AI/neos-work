import { afterEach, describe, expect, it } from 'vitest';

import { getDb } from '../db/schema.js';
import { deleteSetting, setSetting } from '../db/settings.js';
import {
  ageSkillsSearchCache,
  auditRemoteSkill,
  computeSkillFolderHash,
  isSafeSnapshotRelPath,
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

afterEach(() => {
  resetSkillsCatalogState();
  try { deleteSetting('skills.remoteCatalogEnabled'); } catch { /* ignore */ }
  try { deleteSetting('skills.remoteInstallEnabled'); } catch { /* ignore */ }
  getDb().prepare("DELETE FROM skill WHERE name LIKE 'find-skills%' OR name LIKE '_cat_%'").run();
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

  it('returns mocked 502 upstream_unavailable for frontend-design without fetchPath', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({ error: 'not_found' }, 404)));
    try {
      await previewRemoteSkill({ id: 'anthropics/skills/frontend-design' });
      expect.unreachable('should reject');
    } catch (err) {
      expect(err).toBeInstanceOf(SkillsHttpError);
      const e = err as SkillsHttpError;
      expect(e.http).toBe(502);
      expect(e.code).toBe('upstream_unavailable');
      expect(e.extra.fetchPath).toBeUndefined();
    }
  });
});

describe('isSafeSnapshotRelPath', () => {
  it('rejects . and .. segments', () => {
    expect(isSafeSnapshotRelPath('.')).toBe('reject');
    expect(isSafeSnapshotRelPath('foo/.')).toBe('reject');
    expect(isSafeSnapshotRelPath('../SKILL.md')).toBe('reject');
    expect(isSafeSnapshotRelPath('SKILL.md')).toBe('ok');
  });
});

describe('auditRemoteSkill', () => {
  it('returns unavailable=true instead of failing when audit is down', async () => {
    setSkillsCatalogFetchImpl(mockFetch(() => jsonResponse({ error: 'authentication_required' }, 401)));
    const data = await auditRemoteSkill({ id: FIND_SKILLS_ID });
    expect(data).toEqual({ audits: [], unavailable: true });
  });
});
