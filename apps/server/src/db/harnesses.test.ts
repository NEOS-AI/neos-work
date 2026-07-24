import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from './schema.js';
import {
  createCustomHarness,
  deleteCustomHarness,
  getCustomHarness,
  listCustomHarnesses,
  updateCustomHarness,
} from './harnesses.js';

const ID = '_cov_harness_1';

afterEach(() => {
  try { deleteCustomHarness(ID); } catch { /* ignore */ }
});

describe('custom harnesses CRUD', () => {
  it('creates, lists, updates, deletes', () => {
    const h = createCustomHarness({
      id: ID,
      name: 'Cov Harness',
      domain: 'coding',
      description: 'test harness',
      systemPrompt: 'You are a test agent',
      allowedTools: ['read', 'write'],
      constraints: { maxSteps: 5 },
    });
    expect(h.isBuiltIn).toBe(false);
    expect(getCustomHarness(ID)?.allowedTools).toEqual(['read', 'write']);
    expect(getCustomHarness(`  ${ID}  `)?.id).toBe(ID);
    expect(getCustomHarness('   ')).toBeUndefined();
    expect(listCustomHarnesses().some((x) => x.id === ID)).toBe(true);

    const updated = updateCustomHarness(ID, {
      name: 'Renamed Harness',
      allowedTools: ['read'],
      constraints: { maxSteps: 10 },
    });
    expect(updated?.name).toBe('Renamed Harness');
    expect(updated?.allowedTools).toEqual(['read']);
    expect(updated?.constraints).toEqual({ maxSteps: 10 });
    // partial update keeps systemPrompt
    expect(updated?.systemPrompt).toBe('You are a test agent');

    expect(updateCustomHarness('missing', { name: 'x' })).toBeUndefined();
    expect(deleteCustomHarness(ID)).toBe(true);
    expect(getCustomHarness(ID)).toBeUndefined();
    expect(deleteCustomHarness(ID)).toBe(false);
  });

  it('supports finance domain harness and empty tools', () => {
    const id = '_cov_harness_fin';
    try {
      const h = createCustomHarness({
        id,
        name: 'Finance Cov',
        domain: 'finance',
        description: 'fin',
        systemPrompt: 'Analyze markets',
        allowedTools: [],
      });
      expect(h.domain).toBe('finance');
      expect(h.allowedTools).toEqual([]);
      expect(listCustomHarnesses().some((x) => x.id === id && x.domain === 'finance')).toBe(true);
    } finally {
      deleteCustomHarness(id);
    }
  });

  it('trims ids on get/update/delete; blank id is not-found', () => {
    createCustomHarness({
      id: ID,
      name: 'Trim Harness',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'p',
      allowedTools: [],
    });
    expect(getCustomHarness(`  ${ID}  `)?.name).toBe('Trim Harness');
    expect(getCustomHarness('   ')).toBeUndefined();
    expect(updateCustomHarness('  ', { name: 'x' })).toBeUndefined();
    const updated = updateCustomHarness(`  ${ID}  `, { name: 'Trimmed Name' });
    expect(updated?.name).toBe('Trimmed Name');
    expect(deleteCustomHarness('   ')).toBe(false);
    expect(deleteCustomHarness(`  ${ID}  `)).toBe(true);
    expect(getCustomHarness(ID)).toBeUndefined();
  });

  it('rejects oversized systemPrompt on create', () => {
    expect(() =>
      createCustomHarness({
        id: ID,
        name: 'x',
        domain: 'coding',
        description: 'd',
        systemPrompt: 'p'.repeat(100_001),
        allowedTools: [],
      }),
    ).toThrow(/systemPrompt exceeds/i);
  });

  it('trims fields on create/update; rejects invalid id and blank required fields', () => {
    expect(() =>
      createCustomHarness({
        id: '  ',
        name: 'x',
        domain: 'coding',
        description: 'd',
        systemPrompt: 'p',
        allowedTools: [],
      }),
    ).toThrow(/id, name, and systemPrompt/i);
    expect(() =>
      createCustomHarness({
        id: ID,
        name: '  ',
        domain: 'coding',
        description: 'd',
        systemPrompt: 'p',
        allowedTools: [],
      }),
    ).toThrow(/id, name, and systemPrompt/i);
    expect(() =>
      createCustomHarness({
        id: ID,
        name: 'x',
        domain: 'coding',
        description: 'd',
        systemPrompt: '   ',
        allowedTools: [],
      }),
    ).toThrow(/id, name, and systemPrompt/i);

    expect(() =>
      createCustomHarness({
        id: 'bad id!',
        name: 'x',
        domain: 'coding',
        description: 'd',
        systemPrompt: 'p',
        allowedTools: [],
      }),
    ).toThrow(/alphanumeric/i);

    const h = createCustomHarness({
      id: `  ${ID}  `,
      name: '  Name  ',
      domain: '  CODING  ' as never,
      description: '  desc  ',
      systemPrompt: '  prompt  ',
      allowedTools: ['  read  ', '  ', 'write'],
    });
    expect(h.id).toBe(ID);
    expect(h.name).toBe('Name');
    expect(h.domain).toBe('coding');
    expect(h.description).toBe('desc');
    expect(h.systemPrompt).toBe('prompt');
    expect(h.allowedTools).toEqual(['read', 'write']);

    const updated = updateCustomHarness(ID, {
      name: '  Renamed  ',
      domain: '  Finance  ' as never,
      description: '  d2  ',
      systemPrompt: '  p2  ',
      allowedTools: ['  a  ', '', 'b'],
    });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.domain).toBe('finance');
    expect(updated?.description).toBe('d2');
    expect(updated?.systemPrompt).toBe('p2');
    expect(updated?.allowedTools).toEqual(['a', 'b']);
  });

  it('tolerates corrupted allowed_tools / constraints JSON on read', () => {
    createCustomHarness({
      id: ID,
      name: 'Corrupt',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'p',
      allowedTools: ['read'],
      constraints: { maxSteps: 3 },
    });
    const db = getDb();
    db.prepare(
      `UPDATE custom_harness SET allowed_tools_json = ?, constraints_json = ? WHERE id = ?`,
    ).run('not-json', '[1,2,3]', ID);
    const got = getCustomHarness(ID);
    expect(got?.allowedTools).toEqual([]);
    expect(got?.constraints).toEqual({});
    expect(got?.name).toBe('Corrupt');

    // blank name/systemPrompt leave row unchanged
    expect(updateCustomHarness(ID, { name: '   ' })).toBeUndefined();
    expect(updateCustomHarness(ID, { systemPrompt: '   ' })).toBeUndefined();
    expect(getCustomHarness(ID)?.name).toBe('Corrupt');
    expect(getCustomHarness(ID)?.systemPrompt).toBe('p');

    // unknown domain → general; non-array allowedTools → []
    const gen = updateCustomHarness(ID, {
      domain: 'marketing' as never,
      allowedTools: 'nope' as never,
      constraints: [1, 2] as never,
    });
    expect(gen?.domain).toBe('general');
    expect(gen?.allowedTools).toEqual([]);
    expect(gen?.constraints).toEqual({});
  });
});


