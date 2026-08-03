/**
 * Shared Redis URL resolution for collab bus + presence registry (v0.7–v0.8).
 */

export function resolveCollabRedisUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const k of ['NEOS_COLLAB_REDIS_URL', 'REDIS_URL']) {
    const v = env[k];
    if (typeof v === 'string' && !/[\0\r\n]/.test(v) && v.trim()) {
      const t = v.trim();
      if (t.length <= 2_048 && (t.startsWith('redis://') || t.startsWith('rediss://'))) {
        return t;
      }
    }
  }
  return null;
}
