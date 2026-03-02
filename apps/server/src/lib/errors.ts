/**
 * Error sanitization — prevent internal details from leaking to clients.
 */

/** Log the full error server-side and return a safe generic message. */
export function safeError(error: unknown, context: string): string {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${context}]`, message);
  return 'An internal error occurred';
}
