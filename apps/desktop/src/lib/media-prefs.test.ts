import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMediaKindFilter, saveMediaKindFilter } from './media-prefs.js';

describe('media-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to all', () => {
    expect(loadMediaKindFilter()).toBe('all');
  });

  it('round-trips kind filters', () => {
    saveMediaKindFilter('image');
    expect(loadMediaKindFilter()).toBe('image');
    saveMediaKindFilter('audio');
    expect(loadMediaKindFilter()).toBe('audio');
    saveMediaKindFilter('video');
    expect(loadMediaKindFilter()).toBe('video');
    saveMediaKindFilter('all');
    expect(loadMediaKindFilter()).toBe('all');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('neos-media-kind', 'not-a-kind');
    expect(loadMediaKindFilter()).toBe('all');
  });

  it('round-trips other kind', () => {
    saveMediaKindFilter('other');
    expect(loadMediaKindFilter()).toBe('other');
  });

  it('ignores control-char and trims padded stored kind', () => {
    localStorage.setItem('neos-media-kind', `image${'\0'}`);
    expect(loadMediaKindFilter()).toBe('all');
    localStorage.setItem('neos-media-kind', '  audio  ');
    expect(loadMediaKindFilter()).toBe('audio');
  });


  it('tolerates localStorage failures', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(loadMediaKindFilter()).toBe('all');
    expect(() => saveMediaKindFilter('image')).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });

});
