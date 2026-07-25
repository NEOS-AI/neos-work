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

  it('rejects control-char category filters', () => {
    saveSkillsCategoryFilter('coding');
    saveSkillsCategoryFilter('code\ning');
    expect(loadSkillsCategoryFilter()).toBe('all');
    saveSkillsCategoryFilter('\ncoding');
    expect(loadSkillsCategoryFilter()).toBe('all');
    localStorage.setItem('neos-skills-category', 'bad\ncat');
    expect(loadSkillsCategoryFilter()).toBe('all');
  });

  it('caps category length on save and rejects overlong stored values on load', () => {
    saveSkillsCategoryFilter('c'.repeat(150));
    expect(localStorage.getItem('neos-skills-category')?.length).toBe(100);
    expect(loadSkillsCategoryFilter().length).toBe(100);

    localStorage.setItem('neos-skills-category', 'c'.repeat(101));
    expect(loadSkillsCategoryFilter()).toBe('all');
  });
});
