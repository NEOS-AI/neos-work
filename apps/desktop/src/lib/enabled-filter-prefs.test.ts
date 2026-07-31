import { beforeEach, describe, expect, it } from 'vitest';
import { loadEnabledFilter, saveEnabledFilter } from './enabled-filter-prefs.js';

describe('enabled-filter-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to all for each scope', () => {
    expect(loadEnabledFilter('skills')).toBe('all');
    expect(loadEnabledFilter('routines')).toBe('all');
    expect(loadEnabledFilter('memory')).toBe('all');
  });

  it('round-trips per scope independently', () => {
    saveEnabledFilter('skills', 'enabled');
    saveEnabledFilter('routines', 'disabled');
    expect(loadEnabledFilter('skills')).toBe('enabled');
    expect(loadEnabledFilter('routines')).toBe('disabled');
    expect(loadEnabledFilter('memory')).toBe('all');
  });

  it('ignores invalid values', () => {
    localStorage.setItem('neos-skills-enabled', 'maybe');
    expect(loadEnabledFilter('skills')).toBe('all');
  });

  it('ignores control-char and trims padded stored values', () => {
    localStorage.setItem('neos-skills-enabled', `enabled${'\0'}`);
    expect(loadEnabledFilter('skills')).toBe('all');
    localStorage.setItem('neos-skills-enabled', '\nenabled');
    expect(loadEnabledFilter('skills')).toBe('all');
    localStorage.setItem('neos-skills-enabled', '  disabled  ');
    expect(loadEnabledFilter('skills')).toBe('disabled');
  });

});

describe('enabled-filter-prefs storage failures', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('load falls back when storage throws', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      expect(loadEnabledFilter('skills')).toBe('all');
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
      expect(() => saveEnabledFilter('routines', 'enabled')).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
