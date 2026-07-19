/** Allowed Media node config values (aligned with NodeConfigPanel selects). */

export const MEDIA_IMAGE_SIZES = ['1024x1024', '1792x1024', '1024x1792'] as const;
export type MediaImageSize = (typeof MEDIA_IMAGE_SIZES)[number];

export const MEDIA_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
export type MediaVoice = (typeof MEDIA_VOICES)[number];

/** DALL·E quality options (server media-generator). */
export const MEDIA_IMAGE_QUALITIES = ['standard', 'hd'] as const;
export type MediaImageQuality = (typeof MEDIA_IMAGE_QUALITIES)[number];

export function isMediaImageSize(value: unknown): value is MediaImageSize {
  return typeof value === 'string' && (MEDIA_IMAGE_SIZES as readonly string[]).includes(value);
}

export function isMediaVoice(value: unknown): value is MediaVoice {
  return typeof value === 'string' && (MEDIA_VOICES as readonly string[]).includes(value);
}

export function isMediaImageQuality(value: unknown): value is MediaImageQuality {
  return typeof value === 'string' && (MEDIA_IMAGE_QUALITIES as readonly string[]).includes(value);
}

/** OpenAI TTS model options (server media-generator). */
export const MEDIA_TTS_MODELS = ['tts-1', 'tts-1-hd'] as const;
export type MediaTtsModel = (typeof MEDIA_TTS_MODELS)[number];

export function isMediaTtsModel(value: unknown): value is MediaTtsModel {
  return typeof value === 'string' && (MEDIA_TTS_MODELS as readonly string[]).includes(value);
}

/** Re-export shared messaging limits (single source of truth). */
export {
  DISCORD_CONTENT_MAX_LENGTH,
  SLACK_CONTENT_MAX_LENGTH,
} from '@neos-work/shared';

/**
 * Deploy project names: start with alnum, then alnum/hyphen/underscore.
 * Matches common Vercel / Cloudflare project name constraints (simplified).
 */
export function isValidDeployProjectName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(name);
}
