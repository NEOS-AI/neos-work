/**
 * Error sanitization — prevent internal details from leaking to clients.
 */

import { scrubErrorMessage } from '@neos-work/core';

const LOG_CONTEXT_MAX = 100;
const LOG_MESSAGE_MAX = 4_000;
const HTML_ESCAPE_MAX = 50_000;

/**
 * Scrub control chars from validation / 400-style error messages returned to clients.
 * Prefer this over raw `err.message` on API error responses.
 */
export function publicErrorMessage(
  error: unknown,
  fallback: string,
  maxChars = 500,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : fallback;
  return scrubErrorMessage(raw, maxChars) || fallback;
}

/** Log the full error server-side and return a safe generic message. */
function hasLogUnsafeChars(value: string): boolean {
  // Explicit code-point check (avoid regex \0 octal quirks under some transforms)
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0 || c === 10 || c === 13) return true;
  }
  return false;
}

export function safeError(error: unknown, context: string): string {
  let ctx =
    typeof context === 'string' && !hasLogUnsafeChars(context)
      ? context.trim() || 'app'
      : 'app';
  if (ctx.length > LOG_CONTEXT_MAX) ctx = ctx.slice(0, LOG_CONTEXT_MAX);
  // Scrub control chars from log lines (log injection defense)
  let message = error instanceof Error ? error.message : String(error);
  message = message.split('\0').join(' ').replace(/[\r\n]/g, ' ');
  if (message.length > LOG_MESSAGE_MAX) message = message.slice(0, LOG_MESSAGE_MAX);
  console.error(`[${ctx}]`, message);
  return 'An internal error occurred';
}

/** Escape text for safe embedding in HTML (MCP OAuth callback pages, etc.). */
export function escapeHtml(value: string): string {
  let s = typeof value === 'string' ? value : String(value ?? '');
  // Drop null bytes before HTML escaping (DOM / attribute injection defense)
  if (s.includes('\0')) s = s.replace(/\0/g, '');
  if (s.length > HTML_ESCAPE_MAX) s = s.slice(0, HTML_ESCAPE_MAX);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
