/** Discord webhook content hard limit. */
export const DISCORD_CONTENT_MAX_LENGTH = 2000;

/** Slack chat.postMessage text hard limit. */
export const SLACK_CONTENT_MAX_LENGTH = 4000;

/**
 * SSRF-safe Discord webhook URL check (plan Task 8).
 * Requires https + discord.com / discordapp.com host + /api/webhooks/ path.
 */
export function isDiscordWebhookUrl(url: string): boolean {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host !== 'discord.com' && host !== 'discordapp.com') return false;
    return u.pathname.toLowerCase().startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}
