/**
 * Error sanitization — prevent internal details from leaking to clients.
 */

/** Log the full error server-side and return a safe generic message. */
export function safeError(error: unknown, context: string): string {
  const ctx = typeof context === 'string' ? context.trim() || 'app' : 'app';
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${ctx}]`, message);
  return 'An internal error occurred';
}

/** Escape text for safe embedding in HTML (MCP OAuth callback pages, etc.). */
export function escapeHtml(value: string): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
