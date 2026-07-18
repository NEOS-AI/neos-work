import { describe, expect, it } from 'vitest';
import { filterRunsByStatus } from './run-history-filter.js';

describe('filterRunsByStatus', () => {
  const runs = [
    { id: '1', status: 'completed' },
    { id: '2', status: 'failed' },
    { id: '3', status: 'running' },
    { id: '4', status: 'cancelled' },
  ];

  it('returns all when filter is all', () => {
    expect(filterRunsByStatus(runs, 'all')).toHaveLength(4);
  });

  it('filters by status', () => {
    expect(filterRunsByStatus(runs, 'failed').map((r) => r.id)).toEqual(['2']);
    expect(filterRunsByStatus(runs, 'completed')).toHaveLength(1);
  });
});
