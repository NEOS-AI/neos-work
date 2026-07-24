import { afterEach, describe, expect, it } from 'vitest';
import {
  BLOCK_DESCRIPTION_MAX_CHARS,
  BLOCK_PROMPT_TEMPLATE_MAX_CHARS,
  createCustomBlock,
  deleteCustomBlock,
  getCustomBlock,
  listCustomBlocks,
  normalizeImplementationType,
  updateCustomBlock,
} from './blocks.js';
import { getDb } from './schema.js';

const IDS = ['_cov_blk_a', '_cov_blk_b'];

afterEach(() => {
  for (const id of IDS) {
    try { deleteCustomBlock(id); } catch { /* ignore */ }
  }
});

function sampleBlock(id: string, domain: 'general' | 'coding' = 'general') {
  return {
    id,
    name: `Block ${id}`,
    domain,
    category: 'test',
    description: 'cov block',
    implementationType: 'prompt' as const,
    paramDefs: [{ key: 'q', type: 'string' as const, label: 'Q', default: 'x' }],
    inputDescription: 'in',
    outputDescription: 'out',
    promptTemplate: 'Hello {{q}}',
    skillId: undefined as string | undefined,
  };
}

describe('normalizeImplementationType', () => {
  it('allow-lists native/prompt/skill (case-insensitive) and defaults unknown to native', () => {
    expect(normalizeImplementationType('native')).toBe('native');
    expect(normalizeImplementationType('  PROMPT  ')).toBe('prompt');
    expect(normalizeImplementationType('Skill')).toBe('skill');
    expect(normalizeImplementationType('wasm')).toBe('native');
    expect(normalizeImplementationType('')).toBe('native');
    expect(normalizeImplementationType('   ')).toBe('native');
    expect(normalizeImplementationType(null)).toBe('native');
    expect(normalizeImplementationType(undefined)).toBe('native');
    expect(normalizeImplementationType(42)).toBe('native');
  });
});

describe('custom blocks CRUD', () => {
  it('rejects oversized promptTemplate', () => {
    expect(() =>
      createCustomBlock({
        ...sampleBlock(IDS[0]!),
        promptTemplate: 'p'.repeat(50_001),
      }),
    ).toThrow(/promptTemplate exceeds/i);
  });

  it('trims fields on create and rejects blank/invalid id', () => {
    expect(() =>
      createCustomBlock({ ...sampleBlock('bad id!'), id: 'bad id!' }),
    ).toThrow(/alphanumeric/i);
    expect(() =>
      createCustomBlock({ ...sampleBlock(IDS[0]!), id: '  ', name: 'x' }),
    ).toThrow(/id and name/i);

    const created = createCustomBlock({
      ...sampleBlock(IDS[0]!),
      id: `  ${IDS[0]!}  `,
      name: '  Trimmed  ',
      domain: '  CODING  ' as never,
      category: '  test  ',
      description: '  desc  ',
    });
    expect(created.id).toBe(IDS[0]);
    expect(created.name).toBe('Trimmed');
    expect(created.domain).toBe('coding');
    expect(created.category).toBe('test');
    expect(created.description).toBe('desc');
    deleteCustomBlock(IDS[0]!);
  });

  it('normalizes implementationType on create/update (unknown → native)', () => {
    const created = createCustomBlock({
      ...sampleBlock(IDS[0]!),
      implementationType: ' PROMPT ' as never,
    });
    expect(created.implementationType).toBe('prompt');
    expect(getCustomBlock(IDS[0]!)?.implementationType).toBe('prompt');

    const unknown = createCustomBlock({
      ...sampleBlock(IDS[1]!),
      implementationType: 'atom' as never,
    });
    expect(unknown.implementationType).toBe('native');

    const updated = updateCustomBlock(IDS[0]!, {
      implementationType: ' SKILL ' as never,
    });
    expect(updated?.implementationType).toBe('skill');
    expect(listCustomBlocks('  CODING  ').every((b) => b.domain === 'coding')).toBe(true);
  });

  it('creates, gets, lists by domain, updates, deletes', () => {
    const created = createCustomBlock(sampleBlock(IDS[0]!));
    expect(created.isBuiltIn).toBe(false);
    expect(getCustomBlock(IDS[0]!)?.name).toBe(`Block ${IDS[0]}`);
    expect(getCustomBlock(IDS[0]!)?.paramDefs[0]?.default).toBe('x');

    createCustomBlock(sampleBlock(IDS[1]!, 'coding'));
    expect(listCustomBlocks().some((b) => b.id === IDS[0])).toBe(true);
    expect(listCustomBlocks('  coding  ').every((b) => b.domain === 'coding')).toBe(true);
    expect(listCustomBlocks('coding').some((b) => b.id === IDS[1])).toBe(true);
    expect(listCustomBlocks('finance').some((b) => b.id === IDS[0])).toBe(false);
    expect(getCustomBlock(`  ${IDS[0]}  `)?.id).toBe(IDS[0]);
    expect(getCustomBlock('   ')).toBeNull();

    const updated = updateCustomBlock(IDS[0]!, {
      name: '  Renamed  ',
      description: '  updated  ',
      domain: '  Finance  ' as never,
      category: '  cat  ',
      paramDefs: [{ key: 'q', type: 'string', label: 'Q' }],
    });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.domain).toBe('finance');
    expect(updated?.category).toBe('cat');
    expect(getCustomBlock(IDS[0]!)?.description).toBe('updated');
    expect(updateCustomBlock('missing', { name: 'x' })).toBeNull();
    expect(updateCustomBlock(IDS[0]!, { name: '   ' })).toBeNull();
    expect(getCustomBlock(IDS[0]!)?.name).toBe('Renamed'); // blank name rejected, prior value kept

    expect(deleteCustomBlock(IDS[0]!)).toBe(true);
    expect(getCustomBlock(IDS[0]!)).toBeNull();
    expect(deleteCustomBlock(IDS[0]!)).toBe(false);
  });

  it('round-trips optional promptTemplate and skillId as null/undefined', () => {
    createCustomBlock({
      ...sampleBlock(IDS[0]!),
      promptTemplate: undefined,
      skillId: 'skill-1',
    });
    const got = getCustomBlock(IDS[0]!);
    expect(got?.promptTemplate).toBeUndefined();
    expect(got?.skillId).toBe('skill-1');
  });

  it('update trims prompt/skill/io fields; blank domain list returns all; blank id ops no-op', () => {
    createCustomBlock(sampleBlock(IDS[0]!));

    const updated = updateCustomBlock(`  ${IDS[0]!}  `, {
      promptTemplate: '  Hello {{x}}  ',
      skillId: '  skill-2  ',
      inputDescription: '  in  ',
      outputDescription: '  out  ',
      category: '  ', // blank → custom
      domain: '  research  ' as never, // unknown → general
    });
    expect(updated?.promptTemplate).toBe('Hello {{x}}');
    expect(updated?.skillId).toBe('skill-2');
    expect(updated?.inputDescription).toBe('in');
    expect(updated?.outputDescription).toBe('out');
    expect(updated?.category).toBe('custom');
    expect(updated?.domain).toBe('general');

    // blank prompt/skill clear to undefined
    const cleared = updateCustomBlock(IDS[0]!, {
      promptTemplate: '   ',
      skillId: '  ',
    });
    expect(cleared?.promptTemplate).toBeUndefined();
    expect(cleared?.skillId).toBeUndefined();

    expect(updateCustomBlock('   ', { name: 'x' })).toBeNull();
    expect(deleteCustomBlock('   ')).toBe(false);

    // blank domain filter → all blocks
    const all = listCustomBlocks('   ');
    expect(all.some((b) => b.id === IDS[0])).toBe(true);
  });

  it('defaults paramDefs and category; ignores non-array paramDefs on update', () => {
    const created = createCustomBlock({
      id: IDS[0]!,
      name: 'Defaults',
      domain: 'general',
      category: '',
      description: 'd',
      implementationType: 'prompt',
      paramDefs: undefined as never,
      inputDescription: '',
      outputDescription: '',
    });
    expect(created.category).toBe('custom');
    expect(created.paramDefs).toEqual([]);
    expect(getCustomBlock(IDS[0]!)?.paramDefs).toEqual([]);

    const kept = updateCustomBlock(IDS[0]!, {
      paramDefs: 'not-array' as never,
      name: 'Still Defaults',
    });
    expect(kept?.name).toBe('Still Defaults');
    expect(kept?.paramDefs).toEqual([]);

    const replaced = updateCustomBlock(IDS[0]!, {
      paramDefs: [{ key: 'n', type: 'string', label: 'N' }],
    });
    expect(replaced?.paramDefs).toEqual([{ key: 'n', type: 'string', label: 'N' }]);
  });

  it('tolerates corrupt param_defs_json and normalizes domain list filter', () => {
    createCustomBlock(sampleBlock(IDS[0]!));
    getDb()
      .prepare(`UPDATE custom_block SET param_defs_json = ? WHERE id = ?`)
      .run('not-json', IDS[0]!);
    expect(getCustomBlock(IDS[0]!)?.paramDefs).toEqual([]);

    getDb()
      .prepare(`UPDATE custom_block SET param_defs_json = ? WHERE id = ?`)
      .run(JSON.stringify({ key: 'x' }), IDS[0]!);
    expect(getCustomBlock(IDS[0]!)?.paramDefs).toEqual([]);
  });

  it('caps description and rejects oversized promptTemplate / name', () => {
    const created = createCustomBlock({
      ...sampleBlock(IDS[0]!),
      description: 'd'.repeat(BLOCK_DESCRIPTION_MAX_CHARS + 50),
    });
    expect(created.description.length).toBe(BLOCK_DESCRIPTION_MAX_CHARS);

    expect(() =>
      createCustomBlock({
        ...sampleBlock(IDS[1]!),
        promptTemplate: 'p'.repeat(BLOCK_PROMPT_TEMPLATE_MAX_CHARS + 1),
      }),
    ).toThrow(/promptTemplate exceeds/i);

    expect(() =>
      createCustomBlock({
        ...sampleBlock(IDS[1]!),
        name: 'n'.repeat(201),
      }),
    ).toThrow(/max length/i);

    expect(() =>
      createCustomBlock({
        ...sampleBlock(IDS[1]!),
        name: 'bad\nname',
      }),
    ).toThrow(/control characters/i);

    expect(() =>
      createCustomBlock({
        ...sampleBlock(IDS[1]!),
        skillId: 'bad\nskill',
      }),
    ).toThrow(/skillId is invalid/i);

    createCustomBlock(sampleBlock(IDS[1]!));
    expect(
      updateCustomBlock(IDS[1]!, {
        promptTemplate: 'p'.repeat(BLOCK_PROMPT_TEMPLATE_MAX_CHARS + 1),
      }),
    ).toBeNull();
    expect(updateCustomBlock(IDS[1]!, { name: 'x\ny' })).toBeNull();
  });
});

