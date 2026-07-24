import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemory,
  deleteMemory,
  getMemory,
  listMemories,
  searchMemory,
} from './memory.js';

const WS = 'default';
const KEYS = ['_cov_mem_a', '_cov_mem_b', '_cov_mem_c'];

afterEach(() => {
  for (const k of KEYS) {
    try { deleteMemory(WS, k); } catch { /* ignore */ }
  }
});

describe('memory CRUD', () => {
  it('trims workspace/key and rejects blanks', () => {
    expect(getMemory('   ', 'k')).toBeUndefined();
    expect(getMemory(WS, '   ')).toBeUndefined();
    expect(listMemories('   ')).toEqual([]);
    expect(deleteMemory('   ', 'k')).toBe(false);
    expect(() =>
      createMemory({ workspaceId: '  ', key: KEYS[0]!, content: 'x' }),
    ).toThrow(/workspaceId and key/i);

    createMemory({
      workspaceId: `  ${WS}  `,
      key: `  ${KEYS[0]!}  `,
      content: 'padded',
    });
    expect(getMemory(WS, KEYS[0]!)?.content).toBe('padded');
    expect(deleteMemory(`  ${WS}  `, `  ${KEYS[0]!}  `)).toBe(true);
  });

  it('upserts by workspace+key and lists', () => {
    const m1 = createMemory({
      workspaceId: WS,
      key: KEYS[0]!,
      content: 'alpha content',
      tags: ['t1', 't2'],
    });
    expect(m1.key).toBe(KEYS[0]);
    expect(getMemory(WS, KEYS[0]!)?.content).toBe('alpha content');

    const m2 = createMemory({
      workspaceId: WS,
      key: KEYS[0]!,
      content: 'alpha updated',
      tags: ['t1'],
    });
    expect(m2.content).toBe('alpha updated');
    expect(listMemories(WS).some((m) => m.key === KEYS[0])).toBe(true);
  });

  it('searches by content/key and filters tags', () => {
    createMemory({ workspaceId: WS, key: KEYS[0]!, content: 'findme zebra', tags: ['animal'] });
    createMemory({ workspaceId: WS, key: KEYS[1]!, content: 'other', tags: ['plant'] });
    createMemory({ workspaceId: WS, key: KEYS[2]!, content: 'findme bare' });

    const byContent = searchMemory(WS, 'findme');
    expect(byContent.length).toBeGreaterThanOrEqual(2);

    const byKey = searchMemory(WS, KEYS[1]!);
    expect(byKey.some((m) => m.key === KEYS[1])).toBe(true);

    const tagged = searchMemory(WS, 'findme', ['animal']);
    expect(tagged.every((m) => m.key === KEYS[0])).toBe(true);
    expect(searchMemory(WS, 'findme', ['nope'])).toEqual([]);

    expect(deleteMemory(WS, KEYS[0]!)).toBe(true);
    expect(getMemory(WS, KEYS[0]!)).toBeUndefined();
    expect(deleteMemory(WS, KEYS[0]!)).toBe(false);
  });
});
