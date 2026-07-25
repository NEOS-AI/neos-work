import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(localStorage.getItem('neos-remote-url')).toBeNull();
  });

  it('rejects control-char and non-http remote URLs', () => {
    saveRemoteUrl('http://ok:1');
    saveRemoteUrl('\nhttp://evil:1');
    expect(loadRemoteUrl()).toBe('');
    saveRemoteUrl('http://ok:1');
    saveRemoteUrl('file:///etc/passwd');
    expect(loadRemoteUrl()).toBe('');
    saveRemoteUrl('javascript:alert(1)');
    expect(loadRemoteUrl()).toBe('');

    // Corrupted storage: control-char / non-http ignored on load
    localStorage.setItem('neos-remote-url', `http://ok:1${'\0'}`);
    expect(loadRemoteUrl()).toBe('');
    localStorage.setItem('neos-remote-url', 'file:///etc/passwd');
    expect(loadRemoteUrl()).toBe('');
    localStorage.setItem('neos-remote-url', '  http://good:2  ');
    expect(loadRemoteUrl()).toBe('http://good:2');
  });

  it('load returns empty when localStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadRemoteUrl()).toBe('');
    spy.mockRestore();
  });

  it('save swallows localStorage errors', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveRemoteUrl('http://x:1')).not.toThrow();
    spy.mockRestore();
  });
});
