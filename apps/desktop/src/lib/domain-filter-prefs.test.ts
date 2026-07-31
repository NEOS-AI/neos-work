import { beforeEach, describe, expect, it } from 'vitest';
import {
  DOMAIN_FILTER_OPTIONS,
  loadBlocksSourceFilter,
  loadDomainFilter,
  saveBlocksSourceFilter,
  saveDomainFilter,
} from './domain-filter-prefs.js';

describe('domain-filter-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes stable domain chip options', () => {
    expect(DOMAIN_FILTER_OPTIONS).toEqual(['all', 'finance', 'coding', 'research', 'general']);
  });

  it('defaults domain filters to all', () => {
    expect(loadDomainFilter('blocks')).toBe('all');
    expect(loadDomainFilter('templates')).toBe('all');
    expect(loadDomainFilter('harnesses')).toBe('all');
  });

  it('round-trips per scope independently', () => {
    saveDomainFilter('blocks', 'coding');
    saveDomainFilter('templates', 'finance');
    expect(loadDomainFilter('blocks')).toBe('coding');
    expect(loadDomainFilter('templates')).toBe('finance');
    expect(loadDomainFilter('harnesses')).toBe('all');
  });

  it('ignores invalid domain values', () => {
    localStorage.setItem('neos-blocks-domain', 'ops');
    expect(loadDomainFilter('blocks')).toBe('all');
  });

  it('round-trips blocks source filter', () => {
    expect(loadBlocksSourceFilter()).toBe('all');
    saveBlocksSourceFilter('custom');
    expect(loadBlocksSourceFilter()).toBe('custom');
    saveBlocksSourceFilter('builtin');
    expect(loadBlocksSourceFilter()).toBe('builtin');
    localStorage.setItem('neos-blocks-source', 'nope');
    expect(loadBlocksSourceFilter()).toBe('all');
  });

  it('ignores invalid domain on save (leaves previous)', () => {
    saveDomainFilter('blocks', 'coding');
    // @ts-expect-error intentional invalid
    saveDomainFilter('blocks', 'ops');
    expect(loadDomainFilter('blocks')).toBe('coding');
  });

  it('ignores control-char and trims padded domain storage', () => {
    localStorage.setItem('neos-blocks-domain', `coding${'\0'}`);
    expect(loadDomainFilter('blocks')).toBe('all');
    localStorage.setItem('neos-blocks-domain', '  finance  ');
    expect(loadDomainFilter('blocks')).toBe('finance');
    localStorage.setItem('neos-blocks-source', '\ncustom');
    expect(loadBlocksSourceFilter()).toBe('all');
  });

});

describe('domain-filter-prefs storage failures', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('load falls back when storage throws', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      expect(loadDomainFilter('blocks')).toBe('all');
      expect(loadBlocksSourceFilter()).toBe('all');
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  it('save ignores setItem failures', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(() => saveDomainFilter('templates', 'coding')).not.toThrow();
      expect(() => saveBlocksSourceFilter('custom')).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
