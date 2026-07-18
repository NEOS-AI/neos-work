import { describe, expect, it } from 'vitest';
import { pickRecentWorkflows } from './recent-workflows.js';

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
