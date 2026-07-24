/**
 * Normalize engine SERVER_URL for node → server API callbacks.
 * Only http(s) are accepted (defense-in-depth against file:/javascript: SSRF).
 */

const DEFAULT_SERVER_URL = 'http://localhost:3001';

export function safeServerUrl(
  raw: unknown,
  fallback: string = DEFAULT_SERVER_URL,
): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return fallback;
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      return s.replace(/\/+$/, '');
    }
  } catch {
    // ignore invalid URL
  }
  return fallback;
}
