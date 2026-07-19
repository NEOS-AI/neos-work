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
});
