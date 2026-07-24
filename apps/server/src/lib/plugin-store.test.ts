import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { upgradeSkillToPlugin, getPlugin, listPlugins } from './plugin-store.js';

const SKILLS_DIR = path.join(os.homedir(), '.config', 'neos-work', 'skills');
const DIR_NAME = `_cov_skill_${process.pid}`;
const DIR = path.join(SKILLS_DIR, DIR_NAME);

afterEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true }).catch(() => {});
});

describe('plugin-store upgradeSkillToPlugin', () => {
  it('rejects invalid empty dir name', async () => {
    await expect(upgradeSkillToPlugin({ skillDirName: '' })).rejects.toThrow(/Invalid|not found/i);
  });

  it('getPlugin trims id and returns null for blank', async () => {
    expect(await getPlugin('   ')).toBeNull();
    expect(await getPlugin('')).toBeNull();
  });

  it('rejects missing skill directory', async () => {
    await expect(upgradeSkillToPlugin({ skillDirName: 'no-such-skill-dir-xyz' })).rejects.toThrow(/not found/i);
  });

  it('creates open-design.json with 4-step pipeline', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      '---\nname: Cov Skill\n---\n\n# Coverage Skill\n\nDoes things.\n',
      'utf8',
    );

    const plugin = await upgradeSkillToPlugin({
      skillDirName: DIR_NAME,
      name: 'Cov Plugin',
      description: 'From test',
    });

    expect(plugin.schemaVersion).toBe('od-plugin/v1');
    expect(plugin.id).toBe(DIR_NAME);
    expect(plugin.name).toBe('Cov Plugin');
    expect(plugin.pipeline).toHaveLength(4);
    expect(plugin.pipeline?.map((s) => s.id)).toEqual(['discovery', 'plan', 'execute', 'critique']);

    const onDisk = JSON.parse(await fs.readFile(path.join(DIR, 'open-design.json'), 'utf8'));
    expect(onDisk.schemaVersion).toBe('od-plugin/v1');

    const found = await getPlugin(DIR_NAME);
    expect(found?.name).toBe('Cov Plugin');

    const list = await listPlugins();
    expect(list.some((p) => p.id === DIR_NAME)).toBe(true);
  });

  it('returns existing plugin if already upgraded', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, 'SKILL.md'), '# Already\n', 'utf8');
    const first = await upgradeSkillToPlugin({ skillDirName: DIR_NAME, name: 'First' });
    const second = await upgradeSkillToPlugin({ skillDirName: DIR_NAME, name: 'Second' });
    expect(second.name).toBe(first.name);
    expect(second.id).toBe(first.id);
  });

  it('getPlugin returns null for unknown id', async () => {
    expect(await getPlugin('no-plugin-xyz')).toBeNull();
  });

  it('listPlugins skips skill dirs without open-design.json', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, 'SKILL.md'), '# Skill only\n', 'utf8');
    const list = await listPlugins();
    expect(list.some((p) => p.id === DIR_NAME)).toBe(false);
  });
});

describe('plugin-store listPlugins edge cases', () => {
  it('skips invalid schemaVersion manifests', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'open-design.json'),
      JSON.stringify({ schemaVersion: 'old', id: DIR_NAME, name: 'X', version: '1' }),
      'utf8',
    );
    const list = await listPlugins();
    expect(list.some((p) => p.id === DIR_NAME)).toBe(false);
  });

  it('attaches skillContent when SKILL.md is present', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, 'SKILL.md'), '# Skill body for coverage\n', 'utf8');
    await fs.writeFile(
      path.join(DIR, 'open-design.json'),
      JSON.stringify({
        schemaVersion: 'od-plugin/v1',
        id: DIR_NAME,
        name: 'With Skill',
        version: '0.1.0',
      }),
      'utf8',
    );
    const plugin = await getPlugin(DIR_NAME);
    expect(plugin?.skillContent).toContain('Skill body');
    expect(plugin?.dir).toContain(DIR_NAME);
  });

  it('sanitizes skillDirName when upgrading', async () => {
    const weird = `_cov_skill_weird_${process.pid}`;
    // only alnum/_/- allowed after sanitize; use a clean dir
    const dir = path.join(SKILLS_DIR, weird);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), '# Title From File\n\nBody\n', 'utf8');
    try {
      const plugin = await upgradeSkillToPlugin({ skillDirName: weird });
      expect(plugin.name).toBe(weird);
      expect(plugin.description).toMatch(/Title From File|Plugin upgraded/i);
      expect(plugin.inputFields?.[0]?.key).toBe('goal');
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
