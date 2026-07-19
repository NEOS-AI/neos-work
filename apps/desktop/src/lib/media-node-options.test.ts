import { describe, expect, it } from 'vitest';
import {
  DISCORD_CONTENT_MAX_LENGTH,
  isMediaImageSize,
  isMediaVoice,
  isValidDeployProjectName,
  MEDIA_IMAGE_SIZES,
  MEDIA_VOICES,
} from './media-node-options.js';

describe('media-node-options', () => {
  it('exposes stable size and voice catalogs', () => {
    expect([...MEDIA_IMAGE_SIZES]).toEqual(['1024x1024', '1792x1024', '1024x1792']);
    expect([...MEDIA_VOICES]).toEqual(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
    expect(DISCORD_CONTENT_MAX_LENGTH).toBe(2000);
  });

  it('validates image sizes', () => {
    for (const s of MEDIA_IMAGE_SIZES) {
      expect(isMediaImageSize(s)).toBe(true);
    }
    expect(isMediaImageSize('512x512')).toBe(false);
    expect(isMediaImageSize('1024x1024 ')).toBe(false);
    expect(isMediaImageSize(1024)).toBe(false);
    expect(isMediaImageSize(null)).toBe(false);
    expect(isMediaImageSize(undefined)).toBe(false);
  });

  it('validates TTS voices', () => {
    for (const v of MEDIA_VOICES) {
      expect(isMediaVoice(v)).toBe(true);
    }
    expect(isMediaVoice('robot')).toBe(false);
    expect(isMediaVoice('Alloy')).toBe(false);
    expect(isMediaVoice(0)).toBe(false);
  });

  it('validates deploy project names', () => {
    expect(isValidDeployProjectName('neos-deploy')).toBe(true);
    expect(isValidDeployProjectName('My_App1')).toBe(true);
    expect(isValidDeployProjectName('a')).toBe(true);
    expect(isValidDeployProjectName('A' + 'b'.repeat(62))).toBe(true); // 63 chars
    expect(isValidDeployProjectName('A' + 'b'.repeat(63))).toBe(false); // 64 chars
    expect(isValidDeployProjectName('')).toBe(false);
    expect(isValidDeployProjectName('-bad')).toBe(false);
    expect(isValidDeployProjectName('_bad')).toBe(false);
    expect(isValidDeployProjectName('has space')).toBe(false);
    expect(isValidDeployProjectName('dot.name')).toBe(false);
  });
});
