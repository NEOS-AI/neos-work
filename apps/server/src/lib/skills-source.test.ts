import { describe, expect, it } from 'vitest';

import {
  applySourceAliases,
  parseInstallSource,
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
