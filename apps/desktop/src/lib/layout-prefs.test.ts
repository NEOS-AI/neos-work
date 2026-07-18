import { beforeEach, describe, expect, it } from 'vitest';
import { loadLayoutDirection, saveLayoutDirection } from './layout-prefs.js';

describe('layout-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to TB when empty', () => {
    expect(loadLayoutDirection()).toBe('TB');
  });

  it('round-trips LR and TB', () => {
    saveLayoutDirection('LR');
    expect(loadLayoutDirection()).toBe('LR');
    saveLayoutDirection('TB');
    expect(loadLayoutDirection()).toBe('TB');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('neos-layout-direction', 'XX');
    expect(loadLayoutDirection()).toBe('TB');
  });
});
