import { beforeEach, describe, expect, it } from 'vitest';
import { loadRemoteUrl, saveRemoteUrl } from './mode-prefs.js';

describe('mode-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns empty when unset', () => {
    expect(loadRemoteUrl()).toBe('');
  });

  it('saves and loads trimmed remote URL', () => {
    saveRemoteUrl('  http://192.168.1.10:57286  ');
    expect(loadRemoteUrl()).toBe('http://192.168.1.10:57286');
  });

  it('clears storage when empty', () => {
    saveRemoteUrl('http://example:1');
    saveRemoteUrl('   ');
    expect(loadRemoteUrl()).toBe('');
  });
});
