import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadMemoryTypeFilter,
  MEMORY_TYPE_FILTERS,
  saveMemoryTypeFilter,
} from './memory-prefs.js';

describe('memory-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes stable type chip options', () => {
    expect(MEMORY_TYPE_FILTERS).toEqual(['all', 'user', 'session', 'skill', 'reference']);
  });

  it('defaults to all', () => {
    expect(loadMemoryTypeFilter()).toBe('all');
  });

  it('round-trips type filters', () => {
    saveMemoryTypeFilter('skill');
    expect(loadMemoryTypeFilter()).toBe('skill');
    saveMemoryTypeFilter('reference');
    expect(loadMemoryTypeFilter()).toBe('reference');
    saveMemoryTypeFilter('all');
    expect(loadMemoryTypeFilter()).toBe('all');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('neos-memory-type', 'agent');
    expect(loadMemoryTypeFilter()).toBe('all');
  });
});
