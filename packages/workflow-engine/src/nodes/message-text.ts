/**
 * Resolve Slack/Discord message body from node config + upstream inputs.
 * Prefer textTemplate / content / text config fields; interpolate {{key}} from inputs.
 */

export function resolveMessageText(
  config: Record<string, unknown> | undefined,
  inputs: Record<string, unknown>,
): string {
  const raw =
    (typeof config?.['textTemplate'] === 'string' && config['textTemplate']) ||
    (typeof config?.['content'] === 'string' && config['content']) ||
    (typeof config?.['text'] === 'string' && config['text']) ||
    '';

  if (typeof raw === 'string' && raw.trim().length > 0) {
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
