/**
 * Resolve Slack/Discord message body from node config + upstream inputs.
 * Prefer textTemplate / content / text config fields; interpolate {{key}} from inputs.
 */

export {
  DISCORD_CONTENT_MAX_LENGTH,
  SLACK_CONTENT_MAX_LENGTH,
} from '@neos-work/shared';

const MESSAGE_CONFIG_KEYS = ['textTemplate', 'content', 'text'] as const;

/** First non-blank string among config text fields (order: textTemplate → content → text). */
function pickConfigMessage(config: Record<string, unknown> | undefined): string {
  if (!config) return '';
  for (const key of MESSAGE_CONFIG_KEYS) {
    const v = config[key];
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return '';
}

/** Cap resolved messaging body before Slack/Discord hard limits apply. */
export const MESSAGE_TEXT_MAX_CHARS = 16_000;

export function resolveMessageText(
  config: Record<string, unknown> | undefined,
  inputs: Record<string, unknown>,
): string {
  const raw = pickConfigMessage(config);

  let text = '';
  if (raw) {
    text = raw;
    for (const [key, val] of Object.entries(inputs)) {
      // Only interpolate safe placeholder keys (alnum/_/-) — matches plugin runner
      if (!/^[a-zA-Z0-9_-]+$/.test(key)) continue;
      const replacement = typeof val === 'string' ? val : JSON.stringify(val);
      text = text.split(`{{${key}}}`).join(replacement);
    }
  } else if (typeof inputs['text'] === 'string') {
    text = inputs['text'].trim();
  } else if (Object.keys(inputs).length === 0) {
    text = '';
  } else {
    text = JSON.stringify(inputs);
  }

  // Cap body size; null-byte rejection stays at Slack/Discord nodes for clear errors
  if (text.length > MESSAGE_TEXT_MAX_CHARS) {
    text = text.slice(0, MESSAGE_TEXT_MAX_CHARS);
  }
  return text;
}

/** Clamp Tavily max_results to a safe integer range (NodeConfig: 1–20). */
export function resolveMaxResults(config: Record<string, unknown> | undefined, fallback = 5): number {
  const raw = config?.['maxResults'];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(20, Math.max(1, Math.floor(n)));
}

/** Cap web search query length (Tavily practical bound). */
export const SEARCH_QUERY_MAX_CHARS = 2_000;

function normalizeSearchQuery(raw: string): string {
  const q = raw.trim();
  if (!q || /[\0\r\n]/.test(q)) return '';
  return q.length > SEARCH_QUERY_MAX_CHARS ? q.slice(0, SEARCH_QUERY_MAX_CHARS) : q;
}

/** Prefer config.query, then common upstream input keys. */
export function resolveSearchQuery(
  config: Record<string, unknown> | undefined,
  inputs: Record<string, unknown>,
): string {
  const fromConfig = config?.['query'];
  if (typeof fromConfig === 'string' && fromConfig.trim()) {
    return normalizeSearchQuery(fromConfig);
  }
  const fromInput = inputs['query'] ?? inputs['text'];
  if (typeof fromInput === 'string') return normalizeSearchQuery(fromInput);
  if (fromInput !== undefined && fromInput !== null) {
    return normalizeSearchQuery(String(fromInput));
  }
  return '';
}
