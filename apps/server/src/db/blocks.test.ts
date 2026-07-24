import { afterEach, describe, expect, it } from 'vitest';
import {
  createCustomBlock,
  deleteCustomBlock,
  getCustomBlock,
  listCustomBlocks,
  updateCustomBlock,
} from './blocks.js';

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

describe('custom blocks CRUD', () => {
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
      name: 'Renamed',
      description: 'updated',
      paramDefs: [{ key: 'q', type: 'string', label: 'Q' }],
    });
    expect(updated?.name).toBe('Renamed');
    expect(getCustomBlock(IDS[0]!)?.description).toBe('updated');
    expect(updateCustomBlock('missing', { name: 'x' })).toBeNull();

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
});
