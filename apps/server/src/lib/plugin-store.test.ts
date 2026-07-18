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
