import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DESIGN_SYSTEMS_DIR,
  createDesignSystem,
  deleteDesignSystem,
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

  it('returns null for invalid names', async () => {
    expect(await createDesignSystem('../evil')).toBeNull();
    expect(await createDesignSystem('')).toBeNull();
    expect(await createDesignSystem('has space')).toBeNull();
  });

  it('returns null for unknown id', async () => {
    expect(await getDesignSystem('nope')).toBeNull();
    expect(await getDesignSystemContent('nope')).toBeNull();
    expect(await updateDesignSystemContent('nope', 'x')).toBe(false);
    expect(await deleteDesignSystem('nope')).toBe(false);
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
});
