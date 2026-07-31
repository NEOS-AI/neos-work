/** Allowed Media node config values (aligned with NodeConfigPanel selects). */

export const MEDIA_IMAGE_SIZES = ['1024x1024', '1792x1024', '1024x1792'] as const;
export type MediaImageSize = (typeof MEDIA_IMAGE_SIZES)[number];

export const MEDIA_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
export type MediaVoice = (typeof MEDIA_VOICES)[number];

/** DALL·E quality options (server media-generator). */
export const MEDIA_IMAGE_QUALITIES = ['standard', 'hd'] as const;
export type MediaImageQuality = (typeof MEDIA_IMAGE_QUALITIES)[number];

/** Multi-provider catalog ids (Task 8). */
export const MEDIA_PROVIDERS = [
  'openai',
  'azure-openai',
  'google',
  'xai',
  'openai-compatible',
  'stub',
] as const;
export type MediaProviderOption = (typeof MEDIA_PROVIDERS)[number];

export const MEDIA_TYPES = ['image', 'audio', 'video'] as const;
export type MediaTypeOption = (typeof MEDIA_TYPES)[number];

export function isMediaImageSize(value: unknown): value is MediaImageSize {
  if (typeof value !== 'string' || /[\0\r\n]/.test(value)) return false;
  // Normalize case so "1024X1024" matches panel/server allow-lists
  const v = value.trim().toLowerCase();
  return (MEDIA_IMAGE_SIZES as readonly string[]).includes(v);
}

export function isMediaVoice(value: unknown): value is MediaVoice {
  if (typeof value !== 'string' || /[\0\r\n]/.test(value)) return false;
  const v = value.trim().toLowerCase();
  return (MEDIA_VOICES as readonly string[]).includes(v);
}

export function isMediaImageQuality(value: unknown): value is MediaImageQuality {
  if (typeof value !== 'string' || /[\0\r\n]/.test(value)) return false;
  const v = value.trim().toLowerCase();
  return (MEDIA_IMAGE_QUALITIES as readonly string[]).includes(v);
}

export function isMediaProvider(value: unknown): value is MediaProviderOption {
  if (typeof value !== 'string' || /[\0\r\n]/.test(value)) return false;
  const v = value.trim().toLowerCase();
  return (MEDIA_PROVIDERS as readonly string[]).includes(v);
}

export function isMediaType(value: unknown): value is MediaTypeOption {
  if (typeof value !== 'string' || /[\0\r\n]/.test(value)) return false;
  const v = value.trim().toLowerCase();
  return (MEDIA_TYPES as readonly string[]).includes(v);
}

/** OpenAI TTS model options (server media-generator). */
export const MEDIA_TTS_MODELS = ['tts-1', 'tts-1-hd'] as const;
export type MediaTtsModel = (typeof MEDIA_TTS_MODELS)[number];

export function isMediaTtsModel(value: unknown): value is MediaTtsModel {
  if (typeof value !== 'string' || /[\0\r\n]/.test(value)) return false;
  const v = value.trim().toLowerCase();
  return (MEDIA_TTS_MODELS as readonly string[]).includes(v);
}

/** Re-export shared messaging limits (single source of truth). */
export {
  DISCORD_CONTENT_MAX_LENGTH,
  SLACK_CONTENT_MAX_LENGTH,
} from '@neos-work/shared';

/** Re-export shared deploy project name validator (single source of truth). */
export { isValidDeployProjectName } from '@neos-work/shared';
