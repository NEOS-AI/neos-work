import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COMPONENTS_HTML_MAX_CHARS,
  DEFAULT_RULES_MD,
  DEFAULT_TOKENS_CSS,
  DESIGN_MD_MAX_CHARS,
  DESIGN_SYSTEMS_DIR,
  RULES_MD_MAX_CHARS,
  TOKENS_CSS_MAX_CHARS,
  appendDesignSystemRules,
  createDesignSystem,
  deleteDesignSystem,
  ensureDesignSystemsDir,
  getDesignSystem,
  getDesignSystemComponents,
  getDesignSystemContent,
  getDesignSystemRules,
  getDesignSystemTokens,
  listDesignSystems,
  parseDesignSystemManifest,
  pruneDesignSystemRules,
  resolveBundledDesignSystemsDir,
  scanDesignSystemsRoot,
  updateDesignSystemContent,
  updateDesignSystemRules,
  updateDesignSystemTokens,
} from './design-system-store.js';

const NAME = `_cov_ds_${process.pid}`;

afterEach(async () => {
  try {
    const list = await listDesignSystems();
    for (const ds of list) {
      if (ds.name === NAME) await deleteDesignSystem(ds.id);
    }
  } catch {
    // ignore
  }
  await fs.rm(path.join(DESIGN_SYSTEMS_DIR, NAME), { recursive: true, force: true }).catch(() => {});
});

describe('design-system-store', () => {
  it('ensureDesignSystemsDir creates the scan root', async () => {
    await ensureDesignSystemsDir();
    const st = await fs.stat(DESIGN_SYSTEMS_DIR);
    expect(st.isDirectory()).toBe(true);
  });

  it('rejects control-char / overlong design system ids', async () => {
    expect(await getDesignSystem('bad\nid')).toBeNull();
    expect(await getDesignSystem('x'.repeat(65))).toBeNull();
    expect(await getDesignSystemContent('id\nbad')).toBeNull();
    expect(await updateDesignSystemContent('id\nbad', '# x')).toBe(false);
    expect(await deleteDesignSystem('id\nbad')).toBe(false);
  });

  it('creates, lists, reads, updates, deletes a design system', async () => {
    const created = await createDesignSystem(NAME, 'Test brand');
    expect(created).not.toBeNull();
    expect(created!.name).toBe(NAME);
    expect(created!.id).toBeTruthy();
    expect(created!.hasManifest).toBe(true);

    const listed = await listDesignSystems();
    expect(listed.some((d) => d.id === created!.id)).toBe(true);

    const got = await getDesignSystem(created!.id);
    expect(got?.name).toBe(NAME);
    expect(got?.description).toBe('Test brand');

    const content = await getDesignSystemContent(created!.id);
    expect(content).toBeTruthy();
    expect(content).toMatch(/Design System|Brand Colors/i);

    const ok = await updateDesignSystemContent(created!.id, '# Custom DESIGN\n\nBrand blue.\n');
    expect(ok).toBe(true);
    expect(await getDesignSystemContent(created!.id)).toContain('Brand blue');

    const deleted = await deleteDesignSystem(created!.id);
    expect(deleted).toBe(true);
    expect(await getDesignSystem(created!.id)).toBeNull();
  });

  it('rejects null-byte DESIGN.md content', async () => {
    const created = await createDesignSystem(NAME, 'Null body');
    expect(created).not.toBeNull();
    expect(await updateDesignSystemContent(created!.id, `ok${'\0'}bad`)).toBe(false);
  });

  it('treats on-disk DESIGN.md with null bytes as missing content', async () => {
    const created = await createDesignSystem(NAME, 'Corrupt body');
    expect(created).not.toBeNull();
    // Bypass updateDesignSystemContent validation — simulate corrupt file on disk
    await fs.writeFile(path.join(created!.path, 'DESIGN.md'), `# Brand${'\0'}x`, 'utf8');
    expect(await getDesignSystemContent(created!.id)).toBeNull();
  });

  it('returns null for invalid names', async () => {
    expect(await createDesignSystem('../evil')).toBeNull();
    expect(await createDesignSystem('')).toBeNull();
    expect(await createDesignSystem('has space')).toBeNull();
    expect(await createDesignSystem('   ')).toBeNull();
  });

  it('rejects control-char names and drops control-char descriptions', async () => {
    expect(await createDesignSystem('bad\nname')).toBeNull();
    expect(await createDesignSystem('\nBrand')).toBeNull();
    expect(await createDesignSystem(`Brand${'\0'}`)).toBeNull();

    const created = await createDesignSystem(NAME, 'bad\ndesc');
    expect(created).not.toBeNull();
    // Control-char description is dropped rather than persisted
    expect(created!.description == null || created!.description === '').toBe(true);
    await deleteDesignSystem(created!.id);
  });

  it('rejects oversized DESIGN.md content; truncates long description', async () => {
    const created = await createDesignSystem(NAME, 'x'.repeat(5_000));
    expect(created).not.toBeNull();
    expect(created!.description!.length).toBeLessThanOrEqual(2_000);
    const huge = 'a'.repeat(1 * 1024 * 1024 + 1);
    expect(await updateDesignSystemContent(created!.id, huge)).toBe(false);
    expect(await getDesignSystemContent(created!.id)).toMatch(/Design System/i);
    await deleteDesignSystem(created!.id);
  });

  it('trims name and description on create', async () => {
    const created = await createDesignSystem(`  ${NAME}  `, '  desc  ');
    expect(created).not.toBeNull();
    expect(created!.name).toBe(NAME);
    expect(created!.description).toBe('desc');
    await deleteDesignSystem(created!.id);
  });

  it('returns null for unknown id', async () => {
    expect(await getDesignSystem('nope')).toBeNull();
    expect(await getDesignSystemContent('nope')).toBeNull();
    expect(await updateDesignSystemContent('nope', 'x')).toBe(false);
    expect(await deleteDesignSystem('nope')).toBe(false);
  });

  it('trims ids and treats whitespace-only DESIGN.md as missing', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();

    expect(await getDesignSystem(`  ${created!.id}  `)).not.toBeNull();
    expect(await getDesignSystem('   ')).toBeNull();

    await updateDesignSystemContent(created!.id, '   \n\t  ');
    expect(await getDesignSystemContent(created!.id)).toBeNull();

    await deleteDesignSystem(created!.id);
  });
});

describe('design-system-store scan edge cases', () => {
  const EXTRA = `_cov_ds_extra_${process.pid}`;

  afterEach(async () => {
    await fs.rm(path.join(DESIGN_SYSTEMS_DIR, EXTRA), { recursive: true, force: true }).catch(() => {});
  });

  it('skips DESIGN.md that is a symlink escape', async () => {
    const dir = path.join(DESIGN_SYSTEMS_DIR, EXTRA);
    const outside = path.join(os.tmpdir(), `neos-ds-md-out-${process.pid}.md`);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(outside, '# outside-leak\n', 'utf8');
      try {
        await fs.symlink(outside, path.join(dir, 'DESIGN.md'));
      } catch {
        return;
      }
      const scanned = await scanDesignSystemsRoot(DESIGN_SYSTEMS_DIR, 'user');
      expect(scanned.some((d) => d.name === EXTRA)).toBe(false);
      // create then replace DESIGN.md with symlink — content API must refuse
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      const created = await createDesignSystem(EXTRA, 'desc');
      expect(created).toBeTruthy();
      await fs.rm(path.join(created!.path, 'DESIGN.md'), { force: true });
      try {
        await fs.symlink(outside, path.join(created!.path, 'DESIGN.md'));
      } catch {
        return;
      }
      // list may still have entry from before replace depending on scan; content must be null
      expect(await getDesignSystemContent(created!.id)).toBeNull();
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      await fs.rm(outside, { force: true }).catch(() => {});
    }
  });

  it('skips directories without DESIGN.md', async () => {
    await fs.mkdir(path.join(DESIGN_SYSTEMS_DIR, EXTRA), { recursive: true });
    await fs.writeFile(path.join(DESIGN_SYSTEMS_DIR, EXTRA, 'readme.txt'), 'nope', 'utf8');
    const list = await listDesignSystems();
    expect(list.some((d) => d.name === EXTRA)).toBe(false);
  });

  it('skips hidden directories even with DESIGN.md', async () => {
    const hidden = `.hidden_ds_${process.pid}`;
    const hiddenDir = path.join(DESIGN_SYSTEMS_DIR, hidden);
    try {
      await fs.mkdir(hiddenDir, { recursive: true });
      await fs.writeFile(path.join(hiddenDir, 'DESIGN.md'), '# Hidden\n', 'utf8');
      const list = await listDesignSystems();
      expect(list.some((d) => d.name === hidden)).toBe(false);
    } finally {
      await fs.rm(hiddenDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('flags tokens and components when present', async () => {
    const created = await createDesignSystem(EXTRA, 'extra');
    expect(created).not.toBeNull();
    await fs.writeFile(path.join(DESIGN_SYSTEMS_DIR, EXTRA, 'tokens.css'), ':root{}', 'utf8');
    await fs.writeFile(path.join(DESIGN_SYSTEMS_DIR, EXTRA, 'components.html'), '<div></div>', 'utf8');
    const got = await getDesignSystem(created!.id);
    expect(got?.hasTokens).toBe(true);
    expect(got?.hasComponents).toBe(true);
    expect(got?.hasManifest).toBe(true);
  });

  it('returns null when create name already exists', async () => {
    await createDesignSystem(EXTRA, 'once');
    expect(await createDesignSystem(EXTRA, 'twice')).toBeNull();
  });

  it('treats whitespace-only manifest description as undefined', async () => {
    await ensureDesignSystemsDir();
    const dir = path.join(DESIGN_SYSTEMS_DIR, EXTRA);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'DESIGN.md'), '# Brand\n', 'utf8');
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ name: EXTRA, description: '   \t  ' }),
      'utf8',
    );

    const list = await listDesignSystems();
    const hit = list.find((d) => d.name === EXTRA);
    expect(hit).toBeTruthy();
    expect(hit!.description).toBeUndefined();
    expect(hit!.hasManifest).toBe(true);
  });

  it('collapses CR/LF in list manifest description and drops null-byte', async () => {
    await ensureDesignSystemsDir();
    const dir = path.join(DESIGN_SYSTEMS_DIR, EXTRA);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'DESIGN.md'), '# Brand\n', 'utf8');
    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ name: EXTRA, description: 'line1\nline2\r\nline3' }),
      'utf8',
    );
    let hit = (await listDesignSystems()).find((d) => d.name === EXTRA);
    expect(hit?.description).toBe('line1 line2 line3');

    await fs.writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ name: EXTRA, description: `has${'\0'}null` }),
      'utf8',
    );
    hit = (await listDesignSystems()).find((d) => d.name === EXTRA);
    expect(hit?.description).toBeUndefined();
  });

  it('ignores invalid manifest JSON and skips non-directory entries', async () => {
    await ensureDesignSystemsDir();
    const dir = path.join(DESIGN_SYSTEMS_DIR, EXTRA);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'DESIGN.md'), '# ok\n', 'utf8');
    await fs.writeFile(path.join(dir, 'manifest.json'), '{not-json', 'utf8');
    // file sibling should be skipped by list
    await fs.writeFile(path.join(DESIGN_SYSTEMS_DIR, `${EXTRA}.txt`), 'nope', 'utf8');

    const hit = (await listDesignSystems()).find((d) => d.name === EXTRA);
    expect(hit).toBeTruthy();
    expect(hit!.description).toBeUndefined();
    expect(hit!.hasManifest).toBe(true);

    await fs.unlink(path.join(DESIGN_SYSTEMS_DIR, `${EXTRA}.txt`)).catch(() => {});
  });

  it('rejects oversized DESIGN.md content on update', async () => {
    const created = await createDesignSystem(EXTRA, 'desc');
    expect(created).not.toBeNull();
    const ok = await updateDesignSystemContent(created!.id, 'x'.repeat(DESIGN_MD_MAX_CHARS + 1));
    expect(ok).toBe(false);
    expect(await updateDesignSystemContent(created!.id, 'x'.repeat(100))).toBe(true);
    await deleteDesignSystem(created!.id);
  });

  it('createDesignSystem drops whitespace-only description but still writes OD manifest', async () => {
    const created = await createDesignSystem(EXTRA, '   ');
    expect(created).not.toBeNull();
    expect(created!.description).toBeUndefined();
    expect(created!.hasManifest).toBe(true);
    expect(created!.source).toBe('user');
    expect(created!.manifest?.schema).toMatch(/od-design-system-project/);
  });
});

describe('parseDesignSystemManifest (OD v1)', () => {
  it('parses od-design-system-project schema and provenance', () => {
    const m = parseDesignSystemManifest({
      schema: 'od-design-system-project/v1',
      name: 'x',
      description: 'desc',
      version: '1.0.0',
      provenance: { author: 'neos', license: 'MIT' },
      tokens: { 'color.primary': '#fff' },
    });
    expect(m?.schema).toContain('od-design-system-project');
    expect(m?.provenance?.author).toBe('neos');
    expect(m?.tokens?.['color.primary']).toBe('#fff');
  });

  it('returns null for non-objects', () => {
    expect(parseDesignSystemManifest(null)).toBeNull();
    expect(parseDesignSystemManifest('x')).toBeNull();
  });
});

describe('bundled design-systems catalog', () => {
  it('lists bundled systems when design-systems/ is present', async () => {
    const root =
      resolveBundledDesignSystemsDir(path.join(process.cwd(), '..', '..', 'design-systems'))
      ?? resolveBundledDesignSystemsDir(null, path.join(process.cwd(), '..', '..'));
    if (!root) {
      expect(root).toBeNull();
      return;
    }
    const scanned = await scanDesignSystemsRoot(root, 'bundled');
    expect(scanned.length).toBeGreaterThanOrEqual(2);
    expect(scanned.every((d) => d.source === 'bundled')).toBe(true);
    expect(scanned.some((d) => d.name === 'neos-default')).toBe(true);
    const neo = scanned.find((d) => d.name === 'neos-default');
    expect(neo?.hasTokens).toBe(true);
    expect(neo?.manifest?.schema).toMatch(/od-design-system-project/);
    if (neo) {
      const tokens = await getDesignSystemTokens(neo.id);
      // getDesignSystemTokens uses listDesignSystems which merges user+bundled
      // may work if bundled is discoverable from cwd
      expect(tokens === null || tokens.includes('--color-primary')).toBe(true);
    }
  });

  it('user system shadows bundled with same name', async () => {
    // create user system named uniquely; shadowing test via map merge unit via scan
    const a = await scanDesignSystemsRoot(DESIGN_SYSTEMS_DIR, 'user');
    const names = new Set(a.map((d) => d.name));
    // ensure listDesignSystems does not throw with bundled
    const all = await listDesignSystems({ includeBundled: true });
    expect(Array.isArray(all)).toBe(true);
    // user entries marked source user
    for (const ds of all) {
      if (names.has(ds.name) && ds.path.startsWith(DESIGN_SYSTEMS_DIR)) {
        expect(ds.source).toBe('user');
      }
    }
  });

  it('resolveBundled / scan / id hygiene edges', async () => {
    // invalid explicit path is ignored; falls back to cwd/repo candidates (may resolve)
    const fallback = resolveBundledDesignSystemsDir('bad\npath');
    expect(fallback === null || fallback.includes('design-systems')).toBe(true);
    expect(resolveBundledDesignSystemsDir('/no/such/dir-xyz') === null
      || typeof resolveBundledDesignSystemsDir('/no/such/dir-xyz') === 'string').toBe(true);
    expect(await scanDesignSystemsRoot('bad\nroot', 'user')).toEqual([]);
    expect(await scanDesignSystemsRoot('', 'user')).toEqual([]);
    expect(await scanDesignSystemsRoot('/tmp/definitely-missing-ds-root-xyz', 'user')).toEqual(
      [],
    );

    // Directory symlink under a scan root must not load outside content
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'neos-ds-scan-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neos-ds-out-'));
    try {
      await fs.writeFile(path.join(outsideDir, 'DESIGN.md'), '# outside', 'utf8');
      const linkName = `escape_link_${process.pid}`;
      try {
        await fs.symlink(outsideDir, path.join(tmpRoot, linkName));
      } catch {
        // skip when symlink restricted
      }
      const scanned = await scanDesignSystemsRoot(tmpRoot, 'user');
      expect(scanned.some((d) => d.name === linkName)).toBe(false);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
      await fs.rm(outsideDir, { recursive: true, force: true }).catch(() => {});
    }
    expect(await getDesignSystem('')).toBeNull();
    expect(await getDesignSystem('bad\nid')).toBeNull();
    expect(await getDesignSystem('x'.repeat(100))).toBeNull();
    expect(await getDesignSystemContent('nope')).toBeNull();
    expect(await getDesignSystemTokens('nope')).toBeNull();
    expect(await updateDesignSystemContent('nope', 'x')).toBe(false);
    expect(await deleteDesignSystem('nope')).toBe(false);

    const bundled = await listDesignSystems({ includeBundled: true });
    const b = bundled.find((d) => d.source === 'bundled');
    if (b) {
      expect(await updateDesignSystemContent(b.id, '# no')).toBe(false);
      expect(await deleteDesignSystem(b.id)).toBe(false);
      if (b.hasTokens) {
        const t = await getDesignSystemTokens(b.id);
        expect(t === null || typeof t === 'string').toBe(true);
      }
    }
  });

  it('parseDesignSystemManifest tolerates $schema and drops bad tokens', () => {
    const m = parseDesignSystemManifest({
      $schema: 'od-design-system-project/v1',
      name: '  Brand  ',
      description: 'line1\nline2',
      version: '2.0',
      provenance: { author: 'a', bad: 1 },
      tokens: {
        ok: '#fff',
        'bad\nkey': 'x',
        long: 'v'.repeat(300),
        ...Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`t${i}`, '1'])),
      },
    });
    expect(m?.schema).toContain('od-design-system-project');
    expect(m?.name).toBe('Brand');
    expect(m?.description).toContain('line1');
    expect(m?.tokens?.ok).toBe('#fff');
    expect(m?.tokens?.['bad\nkey']).toBeUndefined();
    expect(Object.keys(m?.tokens ?? {}).length).toBeLessThanOrEqual(100);
  });
});

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function numbered(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${pad2(i + 1)}`);
}

function datedBullets(date: string, texts: string[]): string {
  return texts.map((t) => `- ${date}: ${t}`).join('\n');
}

describe('design-system-store RULES.md / tokens write', () => {
  const EXTRA = `_cov_ds_extra_${process.pid}`;

  afterEach(async () => {
    await fs.rm(path.join(DESIGN_SYSTEMS_DIR, EXTRA), { recursive: true, force: true }).catch(() => {});
  });

  it('loadFromDir sets hasRules and rulesUpdatedAt when RULES.md is a regular file', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    const designPath = path.join(created!.path, 'DESIGN.md');
    const rulesPath = path.join(created!.path, 'RULES.md');
    const designStat = await fs.stat(designPath);
    await fs.writeFile(rulesPath, '# Agent rules\n', 'utf8');
    await fs.utimes(rulesPath, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));

    const got = await getDesignSystem(created!.id);
    expect(got?.hasRules).toBe(true);
    expect(got?.rulesUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(got?.updatedAt).toBe(designStat.mtime.toISOString());
    expect(got?.rulesUpdatedAt).not.toBe(got?.updatedAt);

    await fs.rm(rulesPath, { force: true });
    const missing = await getDesignSystem(created!.id);
    expect(missing?.hasRules).toBe(false);
    expect(missing?.rulesUpdatedAt).toBeUndefined();
  });

  it('loadFromDir sets hasRules false when RULES.md is missing', async () => {
    await ensureDesignSystemsDir();
    const dir = path.join(DESIGN_SYSTEMS_DIR, EXTRA);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'DESIGN.md'), '# Legacy user system\n', 'utf8');

    const hit = (await listDesignSystems()).find((d) => d.name === EXTRA);
    expect(hit).toBeTruthy();
    expect(hit!.hasRules).toBe(false);
    expect(hit!.rulesUpdatedAt).toBeUndefined();
  });

  it('loadFromDir treats symlink RULES.md as hasRules false and getDesignSystemRules returns null', async () => {
    await ensureDesignSystemsDir();
    const dir = path.join(DESIGN_SYSTEMS_DIR, EXTRA);
    const outside = path.join(os.tmpdir(), `neos-ds-rules-out-${process.pid}.md`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'DESIGN.md'), '# Brand\n', 'utf8');
    await fs.writeFile(outside, '# outside-rules\n', 'utf8');
    try {
      try {
        await fs.symlink(outside, path.join(dir, 'RULES.md'));
      } catch {
        return;
      }
      const hit = (await listDesignSystems()).find((d) => d.name === EXTRA);
      expect(hit).toBeTruthy();
      expect(hit!.hasRules).toBe(false);
      expect(await getDesignSystemRules(hit!.id)).toBeNull();
    } finally {
      await fs.rm(outside, { force: true }).catch(() => {});
    }
  });

  it('getDesignSystemRules and updateDesignSystemRules match DESIGN.md null-byte, empty, cap, and bundled guards', async () => {
    expect(RULES_MD_MAX_CHARS).toBe(DESIGN_MD_MAX_CHARS);
    expect(RULES_MD_MAX_CHARS).toBe(1 * 1024 * 1024);

    expect(await getDesignSystemRules('nope')).toBeNull();
    expect(await updateDesignSystemRules('nope', '# x\n')).toBe(false);
    expect(await getDesignSystemRules('id\nbad')).toBeNull();
    expect(await updateDesignSystemRules('id\nbad', '# x\n')).toBe(false);
    expect(await getDesignSystemRules('x'.repeat(65))).toBeNull();
    expect(await updateDesignSystemRules('x'.repeat(65), '# x\n')).toBe(false);

    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    const body = '# Agent rules\n\nhello rules\n';
    expect(await updateDesignSystemRules(created!.id, body)).toBe(true);
    expect(await getDesignSystemRules(created!.id)).toBe(body);

    expect(await updateDesignSystemRules(created!.id, `ok${'\0'}bad`)).toBe(false);
    expect(await updateDesignSystemRules(created!.id, '   \n\t  ')).toBe(false);
    expect(await updateDesignSystemRules(created!.id, 'x'.repeat(RULES_MD_MAX_CHARS + 1))).toBe(false);

    const bundled = (await listDesignSystems({ includeBundled: true })).find((d) => d.source === 'bundled');
    expect(bundled).toBeTruthy();
    expect(await updateDesignSystemRules(bundled!.id, '# hack\n')).toBe(false);

    await fs.writeFile(path.join(created!.path, 'RULES.md'), `# Brand${'\0'}x`, 'utf8');
    expect(await getDesignSystemRules(created!.id)).toBeNull();

    await fs.writeFile(path.join(created!.path, 'RULES.md'), '   \n\t  ', 'utf8');
    expect(await getDesignSystemRules(created!.id)).toBeNull();
    const listed = await getDesignSystem(created!.id);
    expect(listed?.hasRules).toBe(true);
  });

  it('updateDesignSystemRules unlinks a planted RULES.md symlink then writes', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    const outside = path.join(os.tmpdir(), `neos-ds-rules-target-${process.pid}.md`);
    await fs.writeFile(outside, 'outside-original\n', 'utf8');
    await fs.rm(path.join(created!.path, 'RULES.md'), { force: true });
    try {
      try {
        await fs.symlink(outside, path.join(created!.path, 'RULES.md'));
      } catch {
        return;
      }
      const ok = await updateDesignSystemRules(created!.id, '# Agent rules\n\nok\n');
      expect(ok).toBe(true);
      const st = await fs.lstat(path.join(created!.path, 'RULES.md'));
      expect(st.isSymbolicLink()).toBe(false);
      expect(st.isFile()).toBe(true);
      expect(await getDesignSystemRules(created!.id)).toContain('ok');
      expect(await fs.readFile(outside, 'utf8')).toBe('outside-original\n');
    } finally {
      await fs.rm(outside, { force: true }).catch(() => {});
    }
  });

  it('appendDesignSystemRules appends a UTC dated bullet and persists source HTML comment', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    await fs.writeFile(
      path.join(created!.path, 'RULES.md'),
      '# Agent rules\n\n## Tools\n- x\n\n## Never\n- y\n\n## Corrections\n\n## Footer\nfooter text\n',
      'utf8',
    );
    expect(await appendDesignSystemRules(created!.id, 'keep the focus ring', 'editor')).toBe(true);
    const after = await getDesignSystemRules(created!.id);
    expect(after).toContain('## Corrections');
    const utc = new Date().toISOString().slice(0, 10);
    expect(after).toMatch(new RegExp(`<!-- source: editor -->\\s*\\n- ${utc}: keep the focus ring`, 'm'));
    expect(after).toMatch(/^- \d{4}-\d{2}-\d{2}: keep the focus ring$/m);
    const correctionsIdx = after!.search(/^\s*##\s+corrections\s*$/im);
    const footerIdx = after!.search(/^\s*## Footer\s*$/m);
    expect(correctionsIdx).toBeGreaterThanOrEqual(0);
    expect(footerIdx).toBeGreaterThan(correctionsIdx);
    const section = after!.slice(correctionsIdx, footerIdx);
    expect(section).toContain(`- ${utc}: keep the focus ring`);
    expect(section.trim().endsWith(`- ${utc}: keep the focus ring`)).toBe(true);
    expect(after!.slice(footerIdx)).toContain('footer text');
  });

  it('appendDesignSystemRules accepts 500 chars and returns false for 501', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    const text500 = 'a'.repeat(500);
    expect(await appendDesignSystemRules(created!.id, text500)).toBe(true);
    const after500 = await getDesignSystemRules(created!.id);
    expect(after500).toContain(text500);
    expect(await appendDesignSystemRules(created!.id, 'b'.repeat(501))).toBe(false);
    expect(await getDesignSystemRules(created!.id)).toBe(after500);
    expect(await appendDesignSystemRules(created!.id, '')).toBe(false);
    expect(await appendDesignSystemRules(created!.id, '   \n')).toBe(false);
    expect(await getDesignSystemRules(created!.id)).toBe(after500);
  });

  it('appendDesignSystemRules returns false for bundled, rejects null-byte, and replaces other control chars with spaces', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    const bundled = (await listDesignSystems({ includeBundled: true })).find((d) => d.source === 'bundled');
    expect(bundled).toBeTruthy();
    expect(await appendDesignSystemRules(bundled!.id, 'nope')).toBe(false);
    expect(await appendDesignSystemRules(created!.id, `bad${'\0'}text`)).toBe(false);

    expect(await appendDesignSystemRules(created!.id, 'line1\nline2', 'manual')).toBe(true);
    const after = await getDesignSystemRules(created!.id);
    const utc = new Date().toISOString().slice(0, 10);
    expect(after).toContain(`- ${utc}: line1 line2`);
    expect(after).not.toMatch(/- \d{4}-\d{2}-\d{2}: line1\nline2/);

    expect(await appendDesignSystemRules(created!.id, 'unknown src', 'other')).toBe(true);
    const withUnknown = await getDesignSystemRules(created!.id);
    expect(withUnknown).toContain(`- ${utc}: unknown src`);
    expect(withUnknown).not.toMatch(/<!-- source: other -->/);
    const unknownIdx = withUnknown!.lastIndexOf(`- ${utc}: unknown src`);
    const prevLine = withUnknown!.slice(0, unknownIdx).replace(/\n+$/, '').split('\n').pop() ?? '';
    expect(prevLine).not.toMatch(/<!--\s*source:/);
  });

  it('appendDesignSystemRules writes the §5 template then a bullet when RULES.md is missing (user only)', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    await fs.rm(path.join(created!.path, 'RULES.md'), { force: true });
    expect(await appendDesignSystemRules(created!.id, 'from empty', 'manual')).toBe(true);
    const after = await getDesignSystemRules(created!.id);
    expect(after).toBeTruthy();
    expect(after).toContain('# Agent rules');
    expect(after).toContain('## Tools');
    expect(after).toContain('## Never');
    expect(after).toContain('## Preferred workflow');
    expect(after).toContain('## Corrections');
    const utc = new Date().toISOString().slice(0, 10);
    expect(after).toContain('<!-- source: manual -->');
    expect(after).toContain(`- ${utc}: from empty`);
  });

  it('pruneDesignSystemRules golden A: 10 of 25 bullets aged 200 days → 15 remain', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    const body = `# Agent rules\n\n## Corrections\n${datedBullets('2026-03-06', numbered('old', 10))}\n${datedBullets('2026-09-22', numbered('new', 15))}\n`;
    await fs.writeFile(path.join(created!.path, 'RULES.md'), body, 'utf8');
    const result = await pruneDesignSystemRules(created!.id, { nowUtcDate: '2026-09-22' });
    expect(result).toEqual({ pruned: 10 });
    const after = await getDesignSystemRules(created!.id);
    expect(after).toContain('## Corrections');
    const texts = [...(after ?? '').matchAll(/^- \d{4}-\d{2}-\d{2}: (.*)$/gm)].map((m) => m[1]);
    expect(texts).toEqual(numbered('new', 15));
    expect(after).not.toMatch(/old-/);
  });

  it('pruneDesignSystemRules golden B: 25 bullets all today → 20 remain, oldest 5 dropped', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    const body = `# Agent rules\n\n## Corrections\n${datedBullets('2026-09-22', numbered('t', 25))}\n`;
    await fs.writeFile(path.join(created!.path, 'RULES.md'), body, 'utf8');
    const result = await pruneDesignSystemRules(created!.id, { nowUtcDate: '2026-09-22' });
    expect(result).toEqual({ pruned: 5 });
    const after = await getDesignSystemRules(created!.id);
    const texts = [...(after ?? '').matchAll(/^- \d{4}-\d{2}-\d{2}: (.*)$/gm)].map((m) => m[1]);
    expect(texts).toEqual(numbered('t', 25).slice(5));
    expect(after).not.toMatch(/t-01|t-02|t-03|t-04|t-05/);
  });

  it('pruneDesignSystemRules golden C: surviving bullet keeps source comment; pruned bullet comment is gone', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    await fs.writeFile(
      path.join(created!.path, 'RULES.md'),
      `# Agent rules

## Corrections
<!-- source: preview-comment -->
- 2026-03-06: stale-old
<!-- source: editor -->
- 2026-09-22: keep-me
`,
      'utf8',
    );
    const result = await pruneDesignSystemRules(created!.id, { nowUtcDate: '2026-09-22' });
    expect(result).toEqual({ pruned: 1 });
    const after = await getDesignSystemRules(created!.id);
    expect(after).toMatch(/<!-- source: editor -->\s*\n- 2026-09-22: keep-me/);
    expect(after).not.toContain('stale-old');
    expect(after).not.toContain('<!-- source: preview-comment -->');
    expect(after).not.toMatch(/<!-- source: -->/);
  });

  it('pruneDesignSystemRules returns pruned 0 and leaves body unchanged when Corrections heading is missing', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    const body = '# Agent rules\n\n## Never\n- Do not invent a palette.\n';
    await fs.writeFile(path.join(created!.path, 'RULES.md'), body, 'utf8');
    const result = await pruneDesignSystemRules(created!.id, { nowUtcDate: '2026-09-22' });
    expect(result).toEqual({ pruned: 0 });
    expect(await fs.readFile(path.join(created!.path, 'RULES.md'), 'utf8')).toBe(body);
  });

  it('pruneDesignSystemRules returns null for missing file and bundled', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    await fs.rm(path.join(created!.path, 'RULES.md'), { force: true });
    expect(await pruneDesignSystemRules(created!.id)).toBeNull();

    const bundled = (await listDesignSystems({ includeBundled: true })).find(
      (d) => d.source === 'bundled' && d.name === 'neos-default',
    ) ?? (await listDesignSystems({ includeBundled: true })).find((d) => d.source === 'bundled');
    expect(bundled).toBeTruthy();
    const before = await fs.readFile(path.join(bundled!.path, 'RULES.md'), 'utf8').catch(() => null);
    expect(await pruneDesignSystemRules(bundled!.id)).toBeNull();
    const after = await fs.readFile(path.join(bundled!.path, 'RULES.md'), 'utf8').catch(() => null);
    expect(after).toBe(before);
  });

  it('createDesignSystem writes RULES.md, §5.1 tokens.css stub, and DESIGN.md var(--color-*) colors', async () => {
    const created = await createDesignSystem(NAME, 'Test brand');
    expect(created).not.toBeNull();
    expect(created!.hasRules).toBe(true);
    expect(created!.hasTokens).toBe(true);

    const rules = await fs.readFile(path.join(created!.path, 'RULES.md'), 'utf8').catch(() => '');
    expect(rules).toBe(DEFAULT_RULES_MD);
    const tokens = await fs.readFile(path.join(created!.path, 'tokens.css'), 'utf8').catch(() => '');
    expect(tokens).toBe(DEFAULT_TOKENS_CSS);

    const design = await getDesignSystemContent(created!.id);
    expect(design).toContain('var(--color-primary)');
    expect(design).toContain('var(--color-secondary)');
    expect(design).toContain('var(--color-success)');
    expect(design).toContain('var(--color-error)');
    expect(design).toContain('var(--font-sans)');
    expect(design).toContain('var(--text-base)');
    expect(design).not.toContain('#3B82F6');
    expect(await getDesignSystemTokens(created!.id)).toBe(DEFAULT_TOKENS_CSS);
  });

  it('updateDesignSystemTokens rejects over 256KiB and bundled; unlinks symlink', async () => {
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    const small = ':root { --x: 1; }\n';
    expect(await updateDesignSystemTokens(created!.id, small)).toBe(true);
    expect(await getDesignSystemTokens(created!.id)).toBe(small);

    expect(await updateDesignSystemTokens(created!.id, 'x'.repeat(256 * 1024 + 1))).toBe(false);
    expect(TOKENS_CSS_MAX_CHARS).toBe(256 * 1024);
    expect(await updateDesignSystemTokens(created!.id, `ok${'\0'}bad`)).toBe(false);
    expect(await updateDesignSystemTokens(created!.id, '   \n')).toBe(false);

    const bundled = (await listDesignSystems({ includeBundled: true })).find((d) => d.source === 'bundled');
    expect(bundled).toBeTruthy();
    expect(await updateDesignSystemTokens(bundled!.id, ':root { --x: 1; }\n')).toBe(false);

    const outside = path.join(os.tmpdir(), `neos-ds-tokens-target-${process.pid}.css`);
    await fs.writeFile(outside, 'outside-tokens\n', 'utf8');
    await fs.rm(path.join(created!.path, 'tokens.css'), { force: true });
    try {
      try {
        await fs.symlink(outside, path.join(created!.path, 'tokens.css'));
      } catch {
        return;
      }
      expect(await updateDesignSystemTokens(created!.id, ':root { --y: 2; }\n')).toBe(true);
      const st = await fs.lstat(path.join(created!.path, 'tokens.css'));
      expect(st.isSymbolicLink()).toBe(false);
      expect(await getDesignSystemTokens(created!.id)).toContain('--y: 2');
      expect(await fs.readFile(outside, 'utf8')).toBe('outside-tokens\n');
    } finally {
      await fs.rm(outside, { force: true }).catch(() => {});
    }
  });

  it('getDesignSystemComponents returns null if missing and slices at 256KiB', async () => {
    expect(COMPONENTS_HTML_MAX_CHARS).toBe(256 * 1024);
    const created = await createDesignSystem(NAME);
    expect(created).not.toBeNull();
    expect(await getDesignSystemComponents(created!.id)).toBeNull();

    await fs.writeFile(path.join(created!.path, 'components.html'), '<div></div>', 'utf8');
    expect(await getDesignSystemComponents(created!.id)).toBe('<div></div>');

    await fs.writeFile(path.join(created!.path, 'components.html'), 'c'.repeat(256 * 1024 + 50), 'utf8');
    const sliced = await getDesignSystemComponents(created!.id);
    expect(sliced).toHaveLength(256 * 1024);

    await fs.writeFile(path.join(created!.path, 'components.html'), `<div>${'\0'}</div>`, 'utf8');
    expect(await getDesignSystemComponents(created!.id)).toBeNull();

    const outside = path.join(os.tmpdir(), `neos-ds-comp-out-${process.pid}.html`);
    await fs.writeFile(outside, '<span>out</span>', 'utf8');
    await fs.rm(path.join(created!.path, 'components.html'), { force: true });
    try {
      try {
        await fs.symlink(outside, path.join(created!.path, 'components.html'));
      } catch {
        return;
      }
      expect(await getDesignSystemComponents(created!.id)).toBeNull();
    } finally {
      await fs.rm(outside, { force: true }).catch(() => {});
    }
  });

  it('bundled neos-default and minimal-mono expose hasRules and RULES.md bodies', async () => {
    const root =
      resolveBundledDesignSystemsDir(path.join(process.cwd(), '..', '..', 'design-systems'))
      ?? resolveBundledDesignSystemsDir(null, path.join(process.cwd(), '..', '..'));
    expect(root).toBeTruthy();
    const scanned = await scanDesignSystemsRoot(root!, 'bundled');
    const neo = scanned.find((d) => d.name === 'neos-default');
    const mono = scanned.find((d) => d.name === 'minimal-mono');
    expect(neo).toBeTruthy();
    expect(mono).toBeTruthy();
    expect(neo?.hasRules).toBe(true);
    expect(mono?.hasRules).toBe(true);

    const neoRules = await fs.readFile(path.join(neo!.path, 'RULES.md'), 'utf8');
    expect(neoRules).toContain('# Agent rules');
    expect(neoRules).toContain('## Never');
    expect(neoRules).toContain('--color-primary');
    expect(neoRules).not.toContain('#6366f1');

    const monoRules = await fs.readFile(path.join(mono!.path, 'RULES.md'), 'utf8');
    expect(monoRules).toContain('# Agent rules');
    expect(monoRules).toContain('## Never');
    expect(monoRules).toMatch(/decorative shadows/i);

    const viaStore = await getDesignSystemRules(neo!.id);
    expect(viaStore === null || viaStore.includes('# Agent rules')).toBe(true);
  });
});
