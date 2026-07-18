import { describe, expect, it } from 'vitest';
import { sortByDateDesc, sortByName } from './list-sort.js';

describe('sortByName', () => {
  it('sorts alphabetically without mutating input', () => {
    const items = [{ name: 'zeta' }, { name: 'Alpha' }, { name: 'beta' }];
    const sorted = sortByName(items);
    expect(sorted.map((i) => i.name)).toEqual(['Alpha', 'beta', 'zeta']);
    expect(items[0]!.name).toBe('zeta');
  });
});

describe('sortByDateDesc', () => {
  it('puts newest first', () => {
    const items = [
      { id: '1', createdAt: '2020-01-01T00:00:00.000Z' },
      { id: '2', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: '3', createdAt: '2022-06-01T00:00:00.000Z' },
    ];
    expect(sortByDateDesc(items, (i) => i.createdAt).map((i) => i.id)).toEqual(['2', '3', '1']);
  });
});
