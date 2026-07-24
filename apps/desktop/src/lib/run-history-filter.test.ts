import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filterRunsByStatus,
  isRunStatusFilter,
  loadRunStatusFilter,
  RUN_STATUS_FILTERS,
  saveRunStatusFilter,
} from './run-history-filter.js';

describe('isRunStatusFilter', () => {
  it('accepts only known chip values', () => {
    for (const v of RUN_STATUS_FILTERS) {
      expect(isRunStatusFilter(v)).toBe(true);
    }
    expect(isRunStatusFilter('pending')).toBe(false);
    expect(isRunStatusFilter('')).toBe(false);
    expect(isRunStatusFilter('COMPLETED')).toBe(false);
  });
});

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

  it('returns all when filter is empty/falsy', () => {
    expect(filterRunsByStatus(runs, '')).toEqual(runs);
  });

  it('filters by status', () => {
    expect(filterRunsByStatus(runs, 'failed').map((r) => r.id)).toEqual(['2']);
    expect(filterRunsByStatus(runs, 'completed')).toHaveLength(1);
  });

  it('filters running and cancelled', () => {
    expect(filterRunsByStatus(runs, 'running').map((r) => r.id)).toEqual(['3']);
    expect(filterRunsByStatus(runs, 'cancelled').map((r) => r.id)).toEqual(['4']);
  });

  it('returns empty when no status matches', () => {
    expect(filterRunsByStatus(runs, 'unknown-status')).toEqual([]);
  });
});

describe('run status filter prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes stable chip options', () => {
    expect(RUN_STATUS_FILTERS).toEqual([
      'all',
      'running',
      'completed',
      'failed',
      'cancelled',
    ]);
  });

  it('defaults to all', () => {
    expect(loadRunStatusFilter()).toBe('all');
  });

  it('round-trips status filters', () => {
    saveRunStatusFilter('failed');
    expect(loadRunStatusFilter()).toBe('failed');
    saveRunStatusFilter('running');
    expect(loadRunStatusFilter()).toBe('running');
    saveRunStatusFilter('all');
    expect(loadRunStatusFilter()).toBe('all');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('neos-run-history-status', 'pending');
    expect(loadRunStatusFilter()).toBe('all');
  });

  it('does not persist invalid filter values', () => {
    // Cast to bypass type guard at call site — runtime must reject
    saveRunStatusFilter('pending' as never);
    expect(localStorage.getItem('neos-run-history-status')).toBeNull();
  });

  it('swallows localStorage errors (private mode / quota)', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadRunStatusFilter()).toBe('all');
    getSpy.mockRestore();

    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveRunStatusFilter('failed')).not.toThrow();
    setSpy.mockRestore();
  });
});
