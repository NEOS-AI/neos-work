import { beforeEach, describe, expect, it } from 'vitest';
import { loadSkillsCategoryFilter, saveSkillsCategoryFilter } from './skills-prefs.js';

describe('skills-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults category filter to all', () => {
    expect(loadSkillsCategoryFilter()).toBe('all');
  });

  it('round-trips category filters', () => {
    saveSkillsCategoryFilter('coding');
    expect(loadSkillsCategoryFilter()).toBe('coding');
    saveSkillsCategoryFilter('all');
    expect(loadSkillsCategoryFilter()).toBe('all');
  });

  it('treats blank save as all', () => {
    saveSkillsCategoryFilter('  ');
    expect(loadSkillsCategoryFilter()).toBe('all');
  });

  it('trims whitespace when loading stored values', () => {
    localStorage.setItem('neos-skills-category', '  coding  ');
    expect(loadSkillsCategoryFilter()).toBe('coding');
  });
});
