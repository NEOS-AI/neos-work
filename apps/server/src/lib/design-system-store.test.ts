import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DESIGN_MD_MAX_CHARS,
  DESIGN_SYSTEMS_DIR,
  createDesignSystem,
  deleteDesignSystem,
  ensureDesignSystemsDir,
  getDesignSystem,
  getDesignSystemContent,
  listDesignSystems,
  updateDesignSystemContent,
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

  it('createDesignSystem drops whitespace-only description (no manifest)', async () => {
    const created = await createDesignSystem(EXTRA, '   ');
    expect(created).not.toBeNull();
    expect(created!.description).toBeUndefined();
    expect(created!.hasManifest).toBe(false);
  });
});
