/** Discord webhook content hard limit. */
export const DISCORD_CONTENT_MAX_LENGTH = 2000;

/** Slack chat.postMessage text hard limit. */
export const SLACK_CONTENT_MAX_LENGTH = 4000;

/**
 * SSRF-safe Discord webhook URL check (plan Task 8).
 * Requires https + discord.com / discordapp.com host + /api/webhooks/ path.
 */
export function isDiscordWebhookUrl(url: string): boolean {
  const raw = typeof url === 'string' ? url : '';
  // Cap URL length; reject control chars before trim (trim would strip CR/LF)
  if (!raw || raw.length > 2_048 || /[\0\r\n]/.test(raw)) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host !== 'discord.com' && host !== 'discordapp.com') return false;
    return u.pathname.toLowerCase().startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}
