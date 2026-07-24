/**
 * Error sanitization — prevent internal details from leaking to clients.
 */

/** Log the full error server-side and return a safe generic message. */
export function safeError(error: unknown, context: string): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${context}]`, message);
  return 'An internal error occurred';
}

/** Escape text for safe embedding in HTML (MCP OAuth callback pages, etc.). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
