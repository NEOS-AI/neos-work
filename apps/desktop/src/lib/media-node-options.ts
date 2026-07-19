/** Allowed Media node config values (aligned with NodeConfigPanel selects). */

export const MEDIA_IMAGE_SIZES = ['1024x1024', '1792x1024', '1024x1792'] as const;
export type MediaImageSize = (typeof MEDIA_IMAGE_SIZES)[number];

export const MEDIA_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;
export type MediaVoice = (typeof MEDIA_VOICES)[number];

export function isMediaImageSize(value: unknown): value is MediaImageSize {
  return typeof value === 'string' && (MEDIA_IMAGE_SIZES as readonly string[]).includes(value);
}

export function isMediaVoice(value: unknown): value is MediaVoice {
  return typeof value === 'string' && (MEDIA_VOICES as readonly string[]).includes(value);
}

/** Discord webhook content hard limit. */
export const DISCORD_CONTENT_MAX_LENGTH = 2000;

/** Slack chat.postMessage text hard limit. */
export const SLACK_CONTENT_MAX_LENGTH = 4000;

/**
 * Deploy project names: start with alnum, then alnum/hyphen/underscore.
 * Matches common Vercel / Cloudflare project name constraints (simplified).
 */
export function isValidDeployProjectName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(name);
}
