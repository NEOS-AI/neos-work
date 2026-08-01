import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  discoverSkills,
  mergeSkillsByPrecedence,
  resolveBundledSkillsDir,
  scanSkillRoot,
} from './discovery.js';
import type { Skill } from '@neos-work/shared';

function skillMd(name: string, body = 'body'): string {
  return `---
name: ${name}
description: ${name} skill
---
${body}
`;
}

function fakeSkill(name: string, source: Skill['source']): Skill {
  return {
    manifest: { name, description: name },
    content: 'x',
    path: `/${source}/${name}.md`,
    source,
  };
}

describe('discoverSkills', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'neos-skills-'));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('returns empty local when workspace has no skills dir', async () => {
    const skills = await discoverSkills(workspace, { includeGlobal: false, includeBundled: false });
    expect(skills.filter((s) => s.source === 'local')).toEqual([]);
  });

  it('returns only global/bundled when workspacePath is omitted', async () => {
    const skills = await discoverSkills(undefined, { includeGlobal: false, includeBundled: false });
    expect(skills).toEqual([]);
  });

  it('ignores control-char workspace paths (no local scan)', async () => {
    const skills = await discoverSkills(`\n${workspace}`, {
      includeGlobal: false,
      includeBundled: false,
    });
    expect(skills.filter((s) => s.source === 'local')).toEqual([]);
  });

  it('discovers flat local markdown under .neos-work/skills', async () => {
    const dir = join(workspace, '.neos-work', 'skills');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'demo.md'), skillMd('demo', 'Body here'));
    await writeFile(join(dir, 'ignore.txt'), 'not a skill');
    await writeFile(join(dir, 'bad.md'), '# no frontmatter');

    const skills = await discoverSkills(workspace, {
      includeGlobal: false,
      includeBundled: false,
    });
    const local = skills.filter((s) => s.source === 'local');
    expect(local).toHaveLength(1);
    expect(local[0]!.manifest.name).toBe('demo');
    expect(local[0]!.content).toContain('Body here');
  });

  it('discovers package layout SKILL.md + examples + assets', async () => {
    const pkg = join(workspace, '.neos-work', 'skills', 'pack-a');
    await mkdir(join(pkg, 'examples'), { recursive: true });
    await mkdir(join(pkg, 'assets'), { recursive: true });
    await writeFile(join(pkg, 'SKILL.md'), skillMd('pack-a', 'Package body'));
    await writeFile(join(pkg, 'examples', 'card.html'), '<html><body>ex</body></html>');
    await writeFile(join(pkg, 'assets', 'logo.svg'), '<svg></svg>');

    const skills = await discoverSkills(workspace, {
      includeGlobal: false,
      includeBundled: false,
    });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.packageDir).toBe(pkg);
    expect(skills[0]!.examples?.[0]?.id).toBe('pack-a:card');
    expect(skills[0]!.assets).toContain('logo.svg');
  });

  it('skips directories without SKILL.md and unreadable entries', async () => {
    const dir = join(workspace, '.neos-work', 'skills');
    await mkdir(join(dir, 'nested-dir'), { recursive: true });
    await writeFile(join(dir, 'ok.md'), skillMd('ok'));
    await symlink(join(dir, 'missing-target.md'), join(dir, 'link.md'));

    const skills = await discoverSkills(workspace, {
      includeGlobal: false,
      includeBundled: false,
    });
    expect(skills.map((s) => s.manifest.name)).toEqual(['ok']);
  });

  it('skips flat and package symlinks that escape the skills root', async () => {
    const dir = join(workspace, '.neos-work', 'skills');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'ok.md'), skillMd('ok'));

    const outside = await mkdtemp(join(tmpdir(), 'neos-skill-out-'));
    try {
      await writeFile(join(outside, 'escape.md'), skillMd('escaped-flat'));
      await mkdir(join(outside, 'pkg'), { recursive: true });
      await writeFile(join(outside, 'pkg', 'SKILL.md'), skillMd('escaped-pkg'));
      try {
        await symlink(join(outside, 'escape.md'), join(dir, 'flat-link.md'));
        await symlink(join(outside, 'pkg'), join(dir, 'pkg-link'));
      } catch {
        return; // symlink may be restricted
      }
      const skills = await discoverSkills(workspace, {
        includeGlobal: false,
        includeBundled: false,
      });
      const names = skills.map((s) => s.manifest.name);
      expect(names).toContain('ok');
      expect(names).not.toContain('escaped-flat');
      expect(names).not.toContain('escaped-pkg');
    } finally {
      await rm(outside, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('skips hidden markdown files in skill directories', async () => {
    const dir = join(workspace, '.neos-work', 'skills');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '.hidden.md'), skillMd('hidden'));
    await writeFile(join(dir, 'visible.md'), skillMd('visible'));

    const skills = await discoverSkills(workspace, {
      includeGlobal: false,
      includeBundled: false,
    });
    expect(skills.map((s) => s.manifest.name)).toEqual(['visible']);
  });
});

describe('mergeSkillsByPrecedence + shadowing', () => {
  it('local shadows bundled with same name', () => {
    const merged = mergeSkillsByPrecedence([
      [fakeSkill('web-landing', 'local')],
      [fakeSkill('web-landing', 'bundled'), fakeSkill('other', 'bundled')],
    ]);
    expect(merged).toHaveLength(2);
    const wl = merged.find((s) => s.manifest.name === 'web-landing')!;
    expect(wl.source).toBe('local');
    expect(merged.find((s) => s.manifest.name === 'other')!.source).toBe('bundled');
  });
});

describe('resolveBundledSkillsDir', () => {
  it('returns null for missing explicit path', () => {
    expect(resolveBundledSkillsDir('/no/such/skills/dir-xyz', tmpdir())).toBeNull();
  });

  it('resolves explicit existing directory', async () => {
    const d = await mkdtemp(join(tmpdir(), 'bundled-'));
    try {
      expect(resolveBundledSkillsDir(d)).toBe(d);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });
});

describe('scanSkillRoot', () => {
  it('returns empty for control-char dir', async () => {
    expect(await scanSkillRoot('\nbad', 'local')).toEqual([]);
  });
});

describe('bundled monorepo skills catalog', () => {
  it('finds ≥5 package skills when skills/ is on disk', async () => {
    // packages/core → repo root
    const repoSkills = join(process.cwd(), '..', '..', 'skills');
    const root = resolveBundledSkillsDir(repoSkills) ?? resolveBundledSkillsDir(null, join(process.cwd(), '..', '..'));
    if (!root) {
      // CI may not copy skills; skip soft
      expect(root).toBeNull();
      return;
    }
    const scanned = await scanSkillRoot(root, 'bundled');
    expect(scanned.length).toBeGreaterThanOrEqual(5);
    expect(scanned.every((s) => s.source === 'bundled')).toBe(true);
    expect(scanned.some((s) => s.manifest.name === 'web-landing')).toBe(true);
    const landing = scanned.find((s) => s.manifest.name === 'web-landing');
    expect(landing?.examples?.some((e) => e.key === 'hero')).toBe(true);
  });
});
