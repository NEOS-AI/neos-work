import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_VIEWPORT_MODES,
  loadArtifactViewport,
  saveArtifactViewport,
} from './artifact-preview-prefs.js';

describe('artifact-preview-prefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes stable viewport modes', () => {
    expect(ARTIFACT_VIEWPORT_MODES).toEqual(['full', 'tablet', 'mobile']);
  });

  it('defaults to full', () => {
    expect(loadArtifactViewport()).toBe('full');
  });

  it('round-trips viewport modes', () => {
    saveArtifactViewport('tablet');
    expect(loadArtifactViewport()).toBe('tablet');
    saveArtifactViewport('mobile');
    expect(loadArtifactViewport()).toBe('mobile');
    saveArtifactViewport('full');
    expect(loadArtifactViewport()).toBe('full');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('neos-artifact-viewport', 'desktop');
    expect(loadArtifactViewport()).toBe('full');
  });

  it('ignores control-char viewport storage', () => {
    localStorage.setItem('neos-artifact-viewport', `mobile${'\0'}`);
    expect(loadArtifactViewport()).toBe('full');
    localStorage.setItem('neos-artifact-viewport', '  tablet  ');
    expect(loadArtifactViewport()).toBe('tablet');
  });

});

describe('artifact-preview-prefs storage failures', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('load falls back when getItem throws', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      expect(loadArtifactViewport()).toBe('full');
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  it('save ignores setItem failures and invalid modes', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(() => saveArtifactViewport('mobile')).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
    saveArtifactViewport('wide' as 'full');
    expect(loadArtifactViewport()).toBe('full');
  });
});
