import { describe, expect, it } from 'vitest';

import {
  applySourceAliases,
  discoverSkillFolders,
  parseInstallSource,
  pickSkillFolder,
  safeCatalogId,
  snapshotDownloadPath,
  SkillsHttpError,
  SOURCE_ALIASES,
} from './skills-source.js';

describe('safeCatalogId', () => {
  it('accepts printable catalog ids and rejects .. / controls / overlong', () => {
    expect(safeCatalogId('vercel-labs/skills/find-skills')).toBe('vercel-labs/skills/find-skills');
    expect(safeCatalogId('  owner/repo  ')).toBe('owner/repo');
    expect(safeCatalogId('a/../b')).toBe('');
    expect(safeCatalogId('bad\nid')).toBe('');
    expect(safeCatalogId('x'.repeat(201))).toBe('');
    expect(safeCatalogId('has space')).toBe('');
  });
});

describe('SOURCE_ALIASES', () => {
  it('rewrites known owner/repo aliases before parse', () => {
    expect(applySourceAliases('coinbase/agentWallet')).toBe('coinbase/agentic-wallet-skills');
    expect(applySourceAliases('coinbase/agentWallet/foo')).toBe('coinbase/agentic-wallet-skills/foo');
    expect(applySourceAliases('vercel-labs/vercel-skills')).toBe('vercel-labs/agent-skills');
    expect(SOURCE_ALIASES['coinbase/agentWallet']).toBe('coinbase/agentic-wallet-skills');
  });
});

describe('parseInstallSource', () => {
  it('parses github owner/repo, owner/repo@slug, github: prefix, and catalog id', () => {
    expect(parseInstallSource({ id: 'vercel-labs/skills' })).toMatchObject({
      kind: 'github',
      owner: 'vercel-labs',
      repo: 'skills',
    });
    expect(parseInstallSource({ id: 'vercel-labs/skills@find-skills' })).toMatchObject({
      kind: 'github',
      slug: 'find-skills',
    });
    expect(parseInstallSource({ id: 'github:vercel-labs/skills' })).toMatchObject({
      kind: 'github',
      owner: 'vercel-labs',
      repo: 'skills',
    });
    expect(parseInstallSource({ id: 'vercel-labs/skills/find-skills' })).toMatchObject({
      kind: 'github',
      owner: 'vercel-labs',
      repo: 'skills',
      slug: 'find-skills',
      id: 'vercel-labs/skills/find-skills',
    });
  });

  it('applies aliases on github shorthand', () => {
    const src = parseInstallSource({ id: 'coinbase/agentWallet/demo' });
    expect(src).toMatchObject({
      kind: 'github',
      owner: 'coinbase',
      repo: 'agentic-wallet-skills',
      slug: 'demo',
    });
  });

  it('parses github.com URLs including /tree/ref and #ref', () => {
    expect(
      parseInstallSource({ url: 'https://github.com/vercel-labs/skills' }),
    ).toMatchObject({ kind: 'github', owner: 'vercel-labs', repo: 'skills' });
    expect(
      parseInstallSource({ url: 'https://github.com/vercel-labs/skills/tree/main/skills/find-skills' }),
    ).toMatchObject({ kind: 'github', ref: 'main', slug: 'find-skills' });
    expect(
      parseInstallSource({ url: 'https://github.com/vercel-labs/skills#v1.2.3' }),
    ).toMatchObject({ kind: 'github', ref: 'v1.2.3' });
  });

  it('classifies SKILL.md URLs as direct and other http(s) as well-known', () => {
    expect(
      parseInstallSource({ url: 'https://example.com/pkg/SKILL.md' }),
    ).toMatchObject({ kind: 'direct' });
    expect(
      parseInstallSource({ url: 'https://skills.example.com/index' }),
    ).toMatchObject({ kind: 'well-known' });
  });

  it('re-parses sidecar URL ids as well-known / direct (not github shorthand)', () => {
    const direct = parseInstallSource({
      id: 'https://example.com/pkg/SKILL.md',
      url: 'https://example.com/pkg/SKILL.md',
    });
    expect(direct).toMatchObject({
      kind: 'direct',
      url: 'https://example.com/pkg/SKILL.md',
    });
    const wk = parseInstallSource({
      id: 'https://skills.example.com/catalog',
      url: 'https://skills.example.com/catalog',
      slug: 'archived',
    });
    expect(wk).toMatchObject({
      kind: 'well-known',
      url: 'https://skills.example.com/catalog',
      slug: 'archived',
    });
    const longHost = `https://${'a'.repeat(180)}.example.com/deep/path/SKILL.md`;
    expect(parseInstallSource({ id: longHost })).toMatchObject({ kind: 'direct', url: longHost });
  });

  it('rejects gitlab/raw/codeload/.git and junk as invalid_source', () => {
    expect(() => parseInstallSource({ url: 'https://gitlab.com/foo/bar' })).toThrow(SkillsHttpError);
    expect(() => parseInstallSource({ url: 'https://codeload.github.com/foo/bar.zip' })).toThrow(
      /invalid_source/,
    );
    expect(() => parseInstallSource({ url: 'git@github.com:foo/bar.git' })).toThrow(/invalid_source/);
    expect(() => parseInstallSource({})).toThrow(/invalid_source/);
  });

  it('snapshotDownloadPath is github+slug and skips explicit ref', () => {
    const ok = parseInstallSource({ id: 'vercel-labs/skills/find-skills' });
    expect(snapshotDownloadPath(ok)).toBe('vercel-labs/skills/find-skills');
    const withRef = parseInstallSource({ id: 'vercel-labs/skills/find-skills', ref: 'main' });
    expect(snapshotDownloadPath(withRef)).toBeNull();
    const noSlug = parseInstallSource({ id: 'vercel-labs/skills' });
    expect(snapshotDownloadPath(noSlug)).toBeNull();
  });
});

describe('discoverSkillFolders / pickSkillFolder', () => {
  const md = (name: string) => `---
name: ${name}
description: ${name}
---
# ${name}
`;

  it('treats a root SKILL.md as a single skill and ignores nested ones', () => {
    const cands = discoverSkillFolders([
      { path: 'SKILL.md', contents: md('root-skill') },
      { path: 'skills/other/SKILL.md', contents: md('other') },
      { path: 'LICENSE', contents: 'MIT' },
    ], 'fallback');
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ slug: 'root-skill', name: 'root-skill', relDir: '' });
  });

  it('finds container children at depth ≤ 3 including hidden curated dirs', () => {
    const cands = discoverSkillFolders([
      { path: 'skills/foo/SKILL.md', contents: md('foo') },
      { path: 'skills/.curated/bar/SKILL.md', contents: md('bar') },
      { path: 'skills/.experimental/baz/SKILL.md', contents: md('baz') },
      { path: 'deep/too/far/SKILL.md', contents: md('nope') },
      { path: 'skills/foo/nested/SKILL.md', contents: md('nested') },
    ], 'fallback');
    expect(cands.map((c) => c.slug).sort()).toEqual(['bar', 'baz', 'foo']);
  });

  it('returns 0 / 1 / N via pickSkillFolder', () => {
    expect(() => pickSkillFolder([])).toThrow(SkillsHttpError);
    try {
      pickSkillFolder([]);
    } catch (err) {
      expect(err).toMatchObject({ http: 404, code: 'no_skills' });
    }

    const one = discoverSkillFolders([{ path: 'skills/only/SKILL.md', contents: md('only') }], 'x');
    expect(pickSkillFolder(one).name).toBe('only');

    const many = discoverSkillFolders([
      { path: 'skills/a/SKILL.md', contents: md('alpha') },
      { path: 'skills/b/SKILL.md', contents: md('beta') },
    ], 'x');
    try {
      pickSkillFolder(many);
      expect.unreachable('should be ambiguous');
    } catch (err) {
      expect(err).toMatchObject({ http: 400, code: 'skill_ambiguous' });
      expect((err as SkillsHttpError).extra.candidates).toEqual([
        { slug: 'a', name: 'alpha' },
        { slug: 'b', name: 'beta' },
      ]);
    }
    expect(pickSkillFolder(many, 'beta').slug).toBe('b');
    try {
      pickSkillFolder(many, 'missing');
    } catch (err) {
      expect(err).toMatchObject({ http: 404, code: 'skill_not_in_source' });
    }
  });
});
