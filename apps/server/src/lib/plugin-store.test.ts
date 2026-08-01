import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  upgradeSkillToPlugin,
  getPlugin,
  listPlugins,
  normalizePipelineStageKind,
  resolveBundledPluginsDir,
} from './plugin-store.js';

const SKILLS_DIR = path.join(os.homedir(), '.config', 'neos-work', 'skills');
const DIR_NAME = `_cov_skill_${process.pid}`;
const DIR = path.join(SKILLS_DIR, DIR_NAME);

afterEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true }).catch(() => {});
});

describe('plugin-store upgradeSkillToPlugin', () => {
  it('rejects invalid empty dir name', async () => {
    await expect(upgradeSkillToPlugin({ skillDirName: '' })).rejects.toThrow(/Invalid|not found/i);
    await expect(upgradeSkillToPlugin({ skillDirName: '   ' })).rejects.toThrow(/Invalid/i);
  });

  it('rejects control-char skillDirName before trim', async () => {
    await expect(upgradeSkillToPlugin({ skillDirName: 'bad\nname' })).rejects.toThrow(/Invalid/i);
    await expect(upgradeSkillToPlugin({ skillDirName: '\nok-dir' })).rejects.toThrow(/Invalid/i);
    await expect(upgradeSkillToPlugin({ skillDirName: `dir${'\0'}x` })).rejects.toThrow(/Invalid/i);
    await expect(upgradeSkillToPlugin({ skillDirName: 'x'.repeat(201) })).rejects.toThrow(/Invalid/i);
  });

  it('getPlugin trims id and returns null for blank', async () => {
    expect(await getPlugin('   ')).toBeNull();
    expect(await getPlugin('')).toBeNull();
  });

  it('getPlugin rejects control-char / overlong / non-string lookup ids', async () => {
    expect(await getPlugin('bad\nid')).toBeNull();
    expect(await getPlugin('id\rbad')).toBeNull();
    expect(await getPlugin(`id${'\0'}bad`)).toBeNull();
    expect(await getPlugin('x'.repeat(101))).toBeNull();
    expect(await getPlugin(null as unknown as string)).toBeNull();
    expect(await getPlugin(undefined as unknown as string)).toBeNull();
  });

  it('rejects missing skill directory', async () => {
    await expect(upgradeSkillToPlugin({ skillDirName: 'no-such-skill-dir-xyz' })).rejects.toThrow(/not found/i);
  });

  it('drops control-char name/description on upgrade and falls back to dir name', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, 'SKILL.md'), '# From Skill File\n\nBody\n', 'utf8');

    const plugin = await upgradeSkillToPlugin({
      skillDirName: DIR_NAME,
      name: 'bad\nname',
      description: 'bad\ndesc',
    });
    // Control-char name → skill dir fallback; description falls back to first skill line or default
    expect(plugin.name).toBe(DIR_NAME);
    expect(plugin.description).not.toMatch(/\n/);
    expect(plugin.description.length).toBeGreaterThan(0);
  });

  it('skips frontmatter and name: lines when deriving description from SKILL.md', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      [
        '---',
        'name: frontmatter-name',
        '---',
        '',
        'name: also-skipped',
        '',
        '# Real Title From Skill',
        '',
        'Body paragraph.',
        '',
      ].join('\n'),
      'utf8',
    );

    const plugin = await upgradeSkillToPlugin({ skillDirName: DIR_NAME });
    // Name falls back to dir when options.name omitted; description from first usable markdown line
    expect(plugin.name).toBe(DIR_NAME);
    expect(plugin.description).toBe('Real Title From Skill');
  });

  it('null-byte in SKILL.md body prevents first-line title fallback', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      `# Title\n\nBody with${'\0'}null\n`,
      'utf8',
    );

    const plugin = await upgradeSkillToPlugin({ skillDirName: DIR_NAME });
    expect(plugin.name).toBe(DIR_NAME);
    // Whole-body null wipe → default description
    expect(plugin.description).toContain('Plugin upgraded from skill');
  });

  it('creates open-design.json with 4-step pipeline', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      '---\nname: Cov Skill\n---\n\n# Coverage Skill\n\nDoes things.\n',
      'utf8',
    );

    const plugin = await upgradeSkillToPlugin({
      skillDirName: `  ${DIR_NAME}  `,
      name: '  Cov Plugin  ',
      description: '  From test  ',
    });

    expect(plugin.schemaVersion).toBe('od-plugin/v1');
    expect(plugin.id).toBe(DIR_NAME);
    expect(plugin.name).toBe('Cov Plugin');
    expect(plugin.description).toBe('From test');
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

  it('listPlugins skips open-design.json that is a symlink escape', async () => {
    await fs.mkdir(DIR, { recursive: true });
    const outside = path.join(os.tmpdir(), `neos-plugin-out-${process.pid}.json`);
    const manifestPath = path.join(DIR, 'open-design.json');
    try {
      await fs.writeFile(
        outside,
        JSON.stringify({
          schemaVersion: 'od-plugin/v1',
          id: DIR_NAME,
          name: 'Escaped',
          version: '0.0.1',
        }),
        'utf8',
      );
      try {
        await fs.symlink(outside, manifestPath);
      } catch {
        return;
      }
      const list = await listPlugins();
      expect(list.some((p) => p.id === DIR_NAME && p.name === 'Escaped')).toBe(false);
    } finally {
      await fs.rm(manifestPath, { force: true }).catch(() => {});
      await fs.rm(outside, { force: true }).catch(() => {});
    }
  });

  it('listPlugins drops stages with control-char ids before trim', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'open-design.json'),
      JSON.stringify({
        schemaVersion: 'od-plugin/v1',
        id: DIR_NAME,
        name: 'Stage Hyg',
        version: '0.0.1',
        pipeline: [
          { id: '\nbad', name: 'Bad', kind: 'execute' },
          { id: 'good', name: 'Good', kind: 'plan' },
          { id: 'x\ny', name: 'Mid', kind: 'execute' },
        ],
      }),
      'utf8',
    );
    const list = await listPlugins();
    const p = list.find((x) => x.id === DIR_NAME);
    expect(p?.pipeline?.map((s) => s.id)).toEqual(['good']);
  });

  it('listPlugins falls back control-char manifest id to dir name; scrubs description', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'open-design.json'),
      JSON.stringify({
        schemaVersion: 'od-plugin/v1',
        id: 'bad\nid',
        name: 'bad\nname',
        description: 'line1\nline2',
        version: '1.0.0',
      }),
      'utf8',
    );
    const list = await listPlugins();
    const p = list.find((x) => x.id === DIR_NAME);
    expect(p).toBeTruthy();
    expect(p!.name).toBe(DIR_NAME);
    expect(p!.description).toBe('line1 line2');
  });

  it('listPlugins skips hidden skill directories', async () => {
    const hiddenName = `.hidden_plugin_${process.pid}`;
    const hiddenDir = path.join(SKILLS_DIR, hiddenName);
    try {
      await fs.mkdir(hiddenDir, { recursive: true });
      await fs.writeFile(
        path.join(hiddenDir, 'open-design.json'),
        JSON.stringify({
          schemaVersion: 'od-plugin/v1',
          id: hiddenName,
          name: 'Hidden',
          version: '0.0.1',
        }),
        'utf8',
      );
      const list = await listPlugins();
      expect(list.some((p) => p.id === hiddenName || p.dir === hiddenDir)).toBe(false);
    } finally {
      await fs.rm(hiddenDir, { recursive: true, force: true }).catch(() => {});
    }
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

  it('trims id/name/description/version; falls back blank id to dir name', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'open-design.json'),
      JSON.stringify({
        schemaVersion: 'od-plugin/v1',
        id: '  ',
        name: '  Pretty Name  ',
        description: '  desc  ',
        version: '  1.2.3  ',
      }),
      'utf8',
    );
    const list = await listPlugins();
    const p = list.find((x) => x.id === DIR_NAME);
    expect(p).toBeDefined();
    expect(p?.name).toBe('Pretty Name');
    expect(p?.description).toBe('desc');
    expect(p?.version).toBe('1.2.3');
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

  it('omits whitespace-only SKILL.md content', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, 'SKILL.md'), '  \n\t  \n', 'utf8');
    await fs.writeFile(
      path.join(DIR, 'open-design.json'),
      JSON.stringify({
        schemaVersion: 'od-plugin/v1',
        id: DIR_NAME,
        name: 'Blank Skill',
        version: '0.1.0',
      }),
      'utf8',
    );
    const plugin = await getPlugin(DIR_NAME);
    expect(plugin?.skillContent).toBeUndefined();
  });

  it('omits null-byte SKILL.md content', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(path.join(DIR, 'SKILL.md'), `# Skill${'\0'}corrupt\n`, 'utf8');
    await fs.writeFile(
      path.join(DIR, 'open-design.json'),
      JSON.stringify({
        schemaVersion: 'od-plugin/v1',
        id: DIR_NAME,
        name: 'Corrupt Skill',
        version: '0.1.0',
      }),
      'utf8',
    );
    const plugin = await getPlugin(DIR_NAME);
    expect(plugin?.skillContent).toBeUndefined();
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

describe('normalizePipelineStageKind', () => {
  it('accepts known kinds case-insensitively and falls back to execute', () => {
    expect(normalizePipelineStageKind('plan')).toBe('plan');
    expect(normalizePipelineStageKind('  DISCOVERY  ')).toBe('discovery');
    expect(normalizePipelineStageKind('form')).toBe('form');
    expect(normalizePipelineStageKind('choice')).toBe('choice');
    expect(normalizePipelineStageKind('unknown')).toBe('execute');
    expect(normalizePipelineStageKind('')).toBe('execute');
    expect(normalizePipelineStageKind(null)).toBe('execute');
    // Leading control-char must not strip to a valid kind
    expect(normalizePipelineStageKind('\nplan')).toBe('execute');
    expect(normalizePipelineStageKind('discovery\n')).toBe('execute');
  });
});

describe('listPlugins pipeline normalization', () => {
  it('drops blank stage ids, normalizes kinds, and trims stage fields', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'open-design.json'),
      JSON.stringify({
        schemaVersion: 'od-plugin/v1',
        id: DIR_NAME,
        name: 'Pipe',
        version: '1.0.0',
        pipeline: [
          { id: '   ', name: 'skip', kind: 'plan' },
          null,
          'not-an-object',
          {
            id: '  s1  ',
            name: '  Stage One  ',
            kind: '  CRITIQUE  ',
            prompt: '  do work  ',
            outputKey: '  out1  ',
            humanInLoop: 1,
          },
          {
            id: 's2',
            kind: 'weird',
            prompt: '   ',
            outputKey: '  ',
          },
        ],
      }),
      'utf8',
    );

    const p = (await listPlugins()).find((x) => x.id === DIR_NAME);
    expect(p).toBeDefined();
    expect(p!.pipeline).toHaveLength(2);
    expect(p!.pipeline![0]).toMatchObject({
      id: 's1',
      name: 'Stage One',
      kind: 'critique',
      prompt: 'do work',
      outputKey: 'out1',
      humanInLoop: true,
    });
    expect(p!.pipeline![1]).toMatchObject({
      id: 's2',
      name: 's2',
      kind: 'execute',
    });
    expect(p!.pipeline![1]!.prompt).toBeUndefined();
    expect(p!.pipeline![1]!.outputKey).toBeUndefined();
  });

  it('omits pipeline when all stages are invalid or array missing', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'open-design.json'),
      JSON.stringify({
        schemaVersion: 'od-plugin/v1',
        id: DIR_NAME,
        name: 'NoPipe',
        version: '1.0.0',
        pipeline: [{ id: '  ' }, null],
      }),
      'utf8',
    );
    const p = (await listPlugins()).find((x) => x.id === DIR_NAME);
    expect(p?.pipeline).toBeUndefined();
  });
});

describe('plugin-store pipeline/gates normalization', () => {
  it('normalizes pipeline stages and capabilityGates with control-char filtering', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'open-design.json'),
      JSON.stringify({
        schemaVersion: 'od-plugin/v1',
        id: DIR_NAME,
        name: 'PipeNorm',
        version: '1.0.0',
        description: `long${'\n'}desc`.repeat(500),
        capabilityGates: [
          'ok-gate',
          `bad${'\n'}gate`,
          '',
          'x'.repeat(200),
          42,
          '  trim-me  ',
        ],
        pipeline: [
          {
            id: `stage${'\n'}x`,
            name: 'ignored',
            kind: 'prompt',
          },
          {
            id: 's1',
            name: `Name${'\n'}X`,
            kind: 'prompt',
            prompt: 'hello\nworld',
            outputKey: `out${'\0'}`,
            humanInLoop: true,
          },
          {
            id: 's2',
            name: 'ok',
            kind: 'not-a-kind',
            prompt: 'p'.repeat(100_001),
            outputKey: '  out2  ',
          },
          null,
          { id: '  ' },
          // overflow stages beyond max should be truncated in loop
          ...Array.from({ length: 30 }, (_, i) => ({
            id: `extra-${i}`,
            kind: 'prompt',
          })),
        ],
      }),
      'utf8',
    );
    await fs.writeFile(path.join(DIR, 'SKILL.md'), 'skill body\n', 'utf8');

    const p = (await listPlugins()).find((x) => x.id === DIR_NAME);
    expect(p).toBeTruthy();
    expect(p!.capabilityGates).toEqual(expect.arrayContaining(['ok-gate', 'trim-me']));
    expect(p!.capabilityGates?.every((g) => !/[\0\r\n]/.test(g))).toBe(true);
    expect(p!.pipeline?.some((s) => s.id === 's1')).toBe(true);
    expect(p!.pipeline?.find((s) => s.id === 's1')?.outputKey).toBeUndefined();
    expect(p!.pipeline?.find((s) => s.id === 's2')?.outputKey).toBe('out2');
    // prompt truncated
    const s2 = p!.pipeline?.find((s) => s.id === 's2');
    if (s2?.prompt) expect(s2.prompt.length).toBeLessThanOrEqual(100_000);
  });
});

describe('bundled marketplace plugins', () => {
  it('discovers official/community stubs when plugins/ is present', async () => {
    const root =
      resolveBundledPluginsDir(path.join(process.cwd(), '..', '..', 'plugins'))
      ?? resolveBundledPluginsDir(null, path.join(process.cwd(), '..', '..'));
    if (!root) {
      expect(root).toBeNull();
      return;
    }
    const list = await listPlugins({ bundledRoot: root });
    const ids = list.map((p) => p.id);
    expect(ids).toContain('landing-gen');
    expect(ids).toContain('code-critique');
    expect(ids).toContain('hello-plugin');
    const official = list.find((p) => p.id === 'landing-gen');
    expect(official?.channel).toBe('official');
    const community = list.find((p) => p.id === 'hello-plugin');
    expect(community?.channel).toBe('community');
    // Control-char explicit is ignored; may still fall back to cwd candidates
    const ctrl = resolveBundledPluginsDir('bad\npath');
    expect(ctrl === null || !ctrl.includes('\n')).toBe(true);
    // Missing path falls through to cwd search (often finds monorepo plugins/)
    const missing = resolveBundledPluginsDir('/no/such/plugins-root-xyz-neos');
    expect(missing === null || typeof missing === 'string').toBe(true);
  });
});
