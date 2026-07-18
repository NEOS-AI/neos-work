import { describe, expect, it } from 'vitest';
import { pickRecentByDate, pickRecentRoutines, pickRecentWorkflows } from './recent-workflows.js';

describe('pickRecentWorkflows', () => {
  const items = [
    { id: '1', name: 'Old', domain: 'general', updatedAt: '2020-01-01T00:00:00.000Z' },
    { id: '2', name: 'New', domain: 'coding', updatedAt: '2024-06-01T00:00:00.000Z' },
    { id: '3', name: 'Mid', domain: 'finance', updatedAt: '2022-01-01T00:00:00.000Z' },
  ];

  it('returns newest first up to limit', () => {
    expect(pickRecentWorkflows(items, 2).map((w) => w.id)).toEqual(['2', '3']);
  });

  it('returns empty for zero limit or empty list', () => {
    expect(pickRecentWorkflows(items, 0)).toEqual([]);
    expect(pickRecentWorkflows([], 5)).toEqual([]);
  });
});

describe('pickRecentByDate / pickRecentRoutines', () => {
  const routines = [
    { id: 'r1', name: 'A', enabled: true, updatedAt: '2021-01-01T00:00:00.000Z' },
    { id: 'r2', name: 'B', enabled: false, updatedAt: '2025-01-01T00:00:00.000Z' },
    { id: 'r3', name: 'C', enabled: true, updatedAt: '2023-01-01T00:00:00.000Z' },
  ];

  it('orders by updatedAt desc', () => {
    expect(pickRecentByDate(routines, 2).map((r) => r.id)).toEqual(['r2', 'r3']);
    expect(pickRecentRoutines(routines, 1).map((r) => r.id)).toEqual(['r2']);
  });
});
