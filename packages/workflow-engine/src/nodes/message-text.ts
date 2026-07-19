/**
 * Resolve Slack/Discord message body from node config + upstream inputs.
 * Prefer textTemplate / content / text config fields; interpolate {{key}} from inputs.
 */

const MESSAGE_CONFIG_KEYS = ['textTemplate', 'content', 'text'] as const;

/** First non-blank string among config text fields (order: textTemplate → content → text). */
function pickConfigMessage(config: Record<string, unknown> | undefined): string {
  if (!config) return '';
  for (const key of MESSAGE_CONFIG_KEYS) {
    const v = config[key];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return '';
}

export function resolveMessageText(
  config: Record<string, unknown> | undefined,
  inputs: Record<string, unknown>,
): string {
  const raw = pickConfigMessage(config);

  if (raw) {
    let text = raw;
    for (const [key, val] of Object.entries(inputs)) {
      const replacement = typeof val === 'string' ? val : JSON.stringify(val);
      text = text.split(`{{${key}}}`).join(replacement);
    }
    return text;
  }

  if (typeof inputs['text'] === 'string') return inputs['text'];
  if (Object.keys(inputs).length === 0) return '';
  return JSON.stringify(inputs);
}

/** Clamp Tavily max_results to a safe integer range (NodeConfig: 1–20). */
export function resolveMaxResults(config: Record<string, unknown> | undefined, fallback = 5): number {
  const raw = config?.['maxResults'];
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(20, Math.max(1, Math.floor(n)));
}

/** Prefer config.query, then common upstream input keys. */
export function resolveSearchQuery(
  config: Record<string, unknown> | undefined,
  inputs: Record<string, unknown>,
): string {
  const fromConfig = config?.['query'];
  if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();
  const fromInput = inputs['query'] ?? inputs['text'];
  if (typeof fromInput === 'string') return fromInput;
  if (fromInput !== undefined && fromInput !== null) return String(fromInput);
  return '';
}
