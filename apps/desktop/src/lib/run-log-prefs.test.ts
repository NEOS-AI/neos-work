import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadRunLogFilter,
  RUN_LOG_FILTERS,
  saveRunLogFilter,
  type RunLogFilterPref,
} from './run-log-prefs.js';

describe('run-log-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes stable chip options', () => {
    expect(RUN_LOG_FILTERS).toEqual(['all', 'progress', 'completed', 'failed', 'lifecycle']);
  });

  it('defaults to all', () => {
    expect(loadRunLogFilter()).toBe('all');
  });

  it('round-trips all valid filters', () => {
    for (const f of RUN_LOG_FILTERS) {
      saveRunLogFilter(f);
      expect(loadRunLogFilter()).toBe(f);
    }
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('neos-run-log-filter', 'streaming');
    expect(loadRunLogFilter()).toBe('all');
  });

  it('does not persist invalid filter values', () => {
    saveRunLogFilter('failed');
    saveRunLogFilter('not-a-filter' as RunLogFilterPref);
    expect(localStorage.getItem('neos-run-log-filter')).toBe('failed');
    expect(loadRunLogFilter()).toBe('failed');
  });

  it('load returns all when localStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadRunLogFilter()).toBe('all');
    spy.mockRestore();
  });

  it('save swallows localStorage errors', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveRunLogFilter('progress')).not.toThrow();
    spy.mockRestore();
  });
});
