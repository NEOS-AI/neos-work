/**
 * Error sanitization — prevent internal details from leaking to clients.
 */

const LOG_CONTEXT_MAX = 100;
const LOG_MESSAGE_MAX = 4_000;
const HTML_ESCAPE_MAX = 50_000;

/** Log the full error server-side and return a safe generic message. */
export function safeError(error: unknown, context: string): string {
  let ctx = typeof context === 'string' ? context.trim() || 'app' : 'app';
  if (ctx.length > LOG_CONTEXT_MAX) ctx = ctx.slice(0, LOG_CONTEXT_MAX);
  let message = error instanceof Error ? error.message : String(error);
  if (message.length > LOG_MESSAGE_MAX) message = message.slice(0, LOG_MESSAGE_MAX);
  console.error(`[${ctx}]`, message);
  return 'An internal error occurred';
}

/** Escape text for safe embedding in HTML (MCP OAuth callback pages, etc.). */
export function escapeHtml(value: string): string {
  let s = typeof value === 'string' ? value : String(value ?? '');
  if (s.length > HTML_ESCAPE_MAX) s = s.slice(0, HTML_ESCAPE_MAX);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
