import { describe, expect, it } from 'vitest';
import { sortByDateDesc, sortByName } from './list-sort.js';

describe('sortByName', () => {
  it('sorts alphabetically without mutating input', () => {
    const items = [{ name: 'zeta' }, { name: 'Alpha' }, { name: 'beta' }];
    const sorted = sortByName(items);
    expect(sorted.map((i) => i.name)).toEqual(['Alpha', 'beta', 'zeta']);
    expect(items[0]!.name).toBe('zeta');
  });

  it('handles empty list', () => {
    expect(sortByName([])).toEqual([]);
  });

  it('sorts with null-byte and multi-line names via scrubbed keys', () => {
    const items = [
      { name: 'b' + String.fromCharCode(0) + 'eta' },
      { name: 'Alpha' },
      { name: 'c' + String.fromCharCode(10) + 'amma' },
    ];
    // beta, Alpha, c amma → Alpha, beta, c amma
    expect(sortByName(items).map((i) => i.name.replace(/\0/g, '').replace(/\n/g, ' '))).toEqual([
      'Alpha',
      'beta',
      'c amma',
    ]);
  });

  it('treats non-string and blank-after-scrub names as empty sort keys', () => {
    const items = [
      { name: 'zeta' },
      { name: null as unknown as string },
      { name: '   ' },
      { name: '\n\r' },
      { name: 'alpha' },
    ];
    const sorted = sortByName(items).map((i) => i.name);
    // empty keys first (localeCompare of ''), then alpha, zeta
    expect(sorted.slice(-2)).toEqual(['alpha', 'zeta']);
    expect(sorted.slice(0, 3).every((n) => !String(n ?? '').trim() || /^[\r\n]+$/.test(String(n)))).toBe(
      true,
    );
  });

  it('collapses CR and LF identically for sort stability', () => {
    const items = [{ name: 'a\rb' }, { name: 'a\nb' }, { name: 'ac' }];
    const keys = sortByName(items).map((i) => i.name.replace(/[\r\n]+/g, ' '));
    // a b sorts before ac
    expect(keys[0]).toBe('a b');
    expect(keys[1]).toBe('a b');
    expect(keys[2]).toBe('ac');
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

  it('sorts SQLite UTC timestamps correctly', () => {
    const items = [
      { id: 'old', createdAt: '2020-01-01 00:00:00' },
      { id: 'new', createdAt: '2024-06-01 12:00:00' },
    ];
    expect(sortByDateDesc(items, (i) => i.createdAt).map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('treats invalid/missing dates as epoch and does not mutate input', () => {
    const items = [
      { id: 'bad', createdAt: 'not-a-date' },
      { id: 'ok', createdAt: '2024-01-01T00:00:00.000Z' },
      { id: 'empty', createdAt: undefined as unknown as string },
    ];
    const sorted = sortByDateDesc(items, (i) => i.createdAt);
    expect(sorted.map((i) => i.id)[0]).toBe('ok');
    expect(items[0]!.id).toBe('bad');
  });
});
