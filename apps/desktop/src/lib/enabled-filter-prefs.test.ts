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
});
