import { describe, expect, it } from 'vitest';
import {
  DISCORD_CONTENT_MAX_LENGTH,
  isMediaImageQuality,
  isMediaImageSize,
  isMediaProvider,
  isMediaTtsModel,
  isMediaType,
  isMediaVoice,
  isValidDeployProjectName,
  MEDIA_IMAGE_QUALITIES,
  MEDIA_IMAGE_SIZES,
  MEDIA_PROVIDERS,
  MEDIA_TTS_MODELS,
  MEDIA_TYPES,
  MEDIA_VOICES,
  SLACK_CONTENT_MAX_LENGTH,
} from './media-node-options.js';

describe('media-node-options', () => {
  it('exposes stable size, voice, quality, and TTS model catalogs', () => {
    expect([...MEDIA_IMAGE_SIZES]).toEqual(['1024x1024', '1792x1024', '1024x1792']);
    expect([...MEDIA_VOICES]).toEqual(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
    expect([...MEDIA_IMAGE_QUALITIES]).toEqual(['standard', 'hd']);
    expect([...MEDIA_TTS_MODELS]).toEqual(['tts-1', 'tts-1-hd']);
    expect(MEDIA_PROVIDERS.length).toBeGreaterThanOrEqual(4);
    expect([...MEDIA_TYPES]).toEqual(['image', 'audio', 'video']);
    expect(DISCORD_CONTENT_MAX_LENGTH).toBe(2000);
    expect(SLACK_CONTENT_MAX_LENGTH).toBe(4000);
  });

  it('validates media providers and types', () => {
    expect(isMediaProvider('openai')).toBe(true);
    expect(isMediaProvider('azure-openai')).toBe(true);
    expect(isMediaProvider('nope')).toBe(false);
    expect(isMediaProvider('\nopenai')).toBe(false);
    expect(isMediaType('video')).toBe(true);
    expect(isMediaType('hologram')).toBe(false);
  });

  it('validates image sizes', () => {
    for (const s of MEDIA_IMAGE_SIZES) {
      expect(isMediaImageSize(s)).toBe(true);
    }
    expect(isMediaImageSize('512x512')).toBe(false);
    expect(isMediaImageSize('  1024x1024  ')).toBe(true);
    expect(isMediaImageSize('1024X1024')).toBe(true);
    expect(isMediaImageSize(1024)).toBe(false);
    expect(isMediaImageSize(null)).toBe(false);
    expect(isMediaImageSize(undefined)).toBe(false);
    // Leading control-char must not strip to a valid size
    expect(isMediaImageSize('\n1024x1024')).toBe(false);
    expect(isMediaVoice('alloy\n')).toBe(false);
    expect(isMediaImageQuality('\nhd')).toBe(false);
    expect(isMediaTtsModel('tts-1\r')).toBe(false);
  });

  it('validates TTS voices', () => {
    for (const v of MEDIA_VOICES) {
      expect(isMediaVoice(v)).toBe(true);
    }
    expect(isMediaVoice('robot')).toBe(false);
    expect(isMediaVoice('  Alloy  ')).toBe(true);
    expect(isMediaVoice(0)).toBe(false);
  });

  it('validates image quality', () => {
    for (const q of MEDIA_IMAGE_QUALITIES) {
      expect(isMediaImageQuality(q)).toBe(true);
    }
    expect(isMediaImageQuality('ultra')).toBe(false);
    expect(isMediaImageQuality('  HD  ')).toBe(true);
    expect(isMediaImageQuality('')).toBe(false);
    expect(isMediaImageQuality(null)).toBe(false);
    expect(isMediaImageQuality(1)).toBe(false);
  });

  it('validates TTS models', () => {
    for (const m of MEDIA_TTS_MODELS) {
      expect(isMediaTtsModel(m)).toBe(true);
    }
    expect(isMediaTtsModel('tts-2')).toBe(false);
    expect(isMediaTtsModel('whisper-1')).toBe(false);
    expect(isMediaTtsModel('  TTS-1  ')).toBe(true);
    expect(isMediaTtsModel('')).toBe(false);
    expect(isMediaTtsModel(null)).toBe(false);
    expect(isMediaTtsModel(undefined)).toBe(false);
    expect(isMediaTtsModel(1)).toBe(false);
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
