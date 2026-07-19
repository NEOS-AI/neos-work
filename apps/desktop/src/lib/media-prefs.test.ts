import { beforeEach, describe, expect, it } from 'vitest';
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
    saveMediaKindFilter('all');
    expect(loadMediaKindFilter()).toBe('all');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('neos-media-kind', 'video');
    expect(loadMediaKindFilter()).toBe('all');
  });

  it('round-trips other kind', () => {
    saveMediaKindFilter('other');
    expect(loadMediaKindFilter()).toBe('other');
  });
});
