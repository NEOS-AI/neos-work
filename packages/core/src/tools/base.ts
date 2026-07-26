/**
 * Base tool interfaces for the agent tool framework.
 */

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
}

/**
 * Scrub control characters from tool / agent error strings before they reach
 * SSE, logs, or UI (null bytes stripped; CR/LF collapsed; length capped).
 */
export function scrubErrorMessage(raw: unknown, maxChars = 2_000): string {
  let s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  if (/\0/.test(s)) s = s.replace(/\0/g, '');
  s = s.replace(/[\r\n]+/g, ' ').trim();
  const max = typeof maxChars === 'number' && maxChars > 0 ? maxChars : 2_000;
  if (s.length > max) s = s.slice(0, max);
  return s;
}
