/**
 * Engine HTTP transport base — shared by project/collab API and full EngineClient.
 * v0.12 M0: extracted from engine.ts to shrink the mega-client.
 */

import type { ApiResponse, HealthResponse } from '@neos-work/shared';

export {
  isActiveRunStatus,
  isTerminalRunStatus,
  normalizeProjectRelPath,
  normalizeRunStatus,
} from '@neos-work/shared';
export type { ProjectRunEvent, ProjectRunStatus, ProjectRunSummary } from '@neos-work/shared';

/**
 * Extract SSE `data:` payload. Rejects null-byte lines (control injection);
 * trims trailing CR from CRLF streams.
 * Exported for unit tests.
 */
export function parseSseDataPayload(line: string): string | null {
  if (typeof line !== 'string' || !line.startsWith('data:')) return null;
  // Allow "data:" or "data: " prefix
  let payload = line.slice(5);
  if (payload.startsWith(' ')) payload = payload.slice(1);
  // Null-byte SSE payloads never parsed (JSON injection / log hygiene)
  if (/\0/.test(payload)) return null;
  // Strip trailing CR from CRLF framing; keep JSON body intact
  if (payload.endsWith('\r')) payload = payload.slice(0, -1);
  payload = payload.trim();
  return payload.length > 0 ? payload : null;
}

/**
 * Extract SSE `event:` name. Control-char / blank → empty (caller skips).
 * Exported for unit tests.
 */
export function parseSseEventName(line: string): string {
  if (typeof line !== 'string' || !line.startsWith('event:')) return '';
  let name = line.slice(6);
  if (name.startsWith(' ')) name = name.slice(1);
  // Control-char event names rejected before trim
  if (/[\0\r\n]/.test(name)) return '';
  return name.trim();
}

/**
 * Format an HTTP error for SSE/UI surfaces. Scrubs control chars from statusText
 * so hostile proxies cannot inject multi-line / null-byte error chrome.
 * Exported for unit tests.
 */
export function formatHttpErrorMessage(status: number, statusText: unknown): string {
  const code = Number.isFinite(status) ? Math.trunc(status) : 0;
  let st = typeof statusText === 'string' ? statusText : '';
  if (/\0/.test(st)) st = st.replace(/\0/g, '');
  st = st.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  return st ? `HTTP ${code}: ${st}` : `HTTP ${code}`;
}

/**
 * Scrub API error strings (webhook fire, etc.) before surfacing to UI.
 * Exported for unit tests.
 */
export function scrubApiErrorMessage(raw: unknown, fallback = 'Request failed'): string {
  let s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  if (/\0/.test(s)) s = s.replace(/\0/g, '');
  s = s.replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  return s || fallback;
}

/**
 * Parse an ApiResponse JSON body. Invalid JSON / non-object bodies never throw
 * SyntaxError into UI handlers — returns a scrubbed `{ ok: false, error }`.
 * Exported for unit tests.
 */
export async function readApiResponse<T = unknown>(res: Response): Promise<ApiResponse<T>> {
  try {
    const body: unknown = await res.json();
    // Arrays / null are typeof object — only plain objects are ApiResponse envelopes
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const envelope = body as ApiResponse<T>;
      // Defense-in-depth: scrub control-char error strings from any envelope
      if (envelope.error != null) {
        return {
          ...envelope,
          error: scrubApiErrorMessage(envelope.error, 'Request failed'),
        };
      }
      return envelope;
    }
  } catch {
    /* invalid JSON */
  }
  return {
    ok: false,
    error: scrubApiErrorMessage(
      res.statusText,
      formatHttpErrorMessage(res.status, res.statusText),
    ),
  };
}

/**
 * Parse health JSON. Invalid body throws a clean Error (checkConnection catches).
 * Exported for unit tests.
 */
export async function readHealthResponse(res: Response): Promise<HealthResponse> {
  try {
    const body: unknown = await res.json();
    if (
      body
      && typeof body === 'object'
      && !Array.isArray(body)
      && body !== null
      && 'status' in body
    ) {
      return body as HealthResponse;
    }
  } catch {
    /* invalid JSON */
  }
  throw new Error(formatHttpErrorMessage(res.status, res.statusText));
}


export class EngineTransport {
  protected baseUrl: string;
  protected authToken: string | null = null;

  constructor(baseUrl: string) {
    // Control-char / non-string base URLs rejected (fetch / log hygiene)
    if (typeof baseUrl !== 'string' || /[\0\r\n]/.test(baseUrl)) {
      this.baseUrl = '';
      return;
    }
    // Trim and strip trailing slashes so `${base}/api/...` joins cleanly
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    this.baseUrl = trimmed;
  }

  get url(): string {
    return this.baseUrl;
  }

  /**
   * Set Bearer token for API calls.
   * Control-char / blank tokens are rejected (header injection defense) — clears auth.
   */
  setAuthToken(token: string | null | undefined): void {
    if (token == null || typeof token !== 'string') {
      this.authToken = null;
      return;
    }
    // Reject control chars before trim (trim would strip CR/LF)
    if (/[\0\r\n]/.test(token)) {
      this.authToken = null;
      return;
    }
    const next = token.trim();
    this.authToken = next || null;
  }

  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Defense-in-depth: never emit control-char Bearer tokens
    if (
      this.authToken
      && typeof this.authToken === 'string'
      && !/[\0\r\n]/.test(this.authToken)
      && this.authToken.trim()
    ) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  /**
   * Sanitize an entity id for API use (body or path).
   * Rejects control-char / blank / overlong / path separators / `.` / `..`.
   * Returns the trimmed raw string when valid (callers fail closed on '').
   */
  protected sanitizeId(raw: unknown, maxChars = 200): string {
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
    const s = raw.trim();
    if (!s || s.length > maxChars) return '';
    // Path separators and bare relative segments never allowed in ids
    if (s.includes('/') || s.includes('\\') || s === '.' || s === '..') return '';
    return s;
  }

  /**
   * Sanitize + encode a path-segment id for URL construction.
   * Returns empty string when invalid (callers fail closed).
   */
  protected pathSegment(raw: unknown, maxChars = 200): string {
    const s = this.sanitizeId(raw, maxChars);
    return s ? encodeURIComponent(s) : '';
  }

  /**
   * Settings key path segment (align with server paramSettingKey).
   * Alphanumeric / underscore / hyphen / dot; max 100 chars.
   */
  protected settingKeySegment(raw: unknown): string {
    const s = this.sanitizeId(raw, 100);
    if (!s || !/^[a-zA-Z0-9_.-]+$/.test(s)) return '';
    return encodeURIComponent(s);
  }

  /**
   * Media filename path segment (align with server isSafeMediaFilename).
   * Alphanumeric / underscore / hyphen / dot only; no leading dots.
   */
  protected mediaFilenameSegment(raw: unknown, maxChars = 200): string {
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
    const name = raw.trim();
    if (!name || name === '.' || name === '..') return '';
    if (name.startsWith('.')) return '';
    const max = typeof maxChars === 'number' && maxChars > 0 ? maxChars : 200;
    if (name.length > max) return '';
    if (!/^[a-zA-Z0-9_\-.]+$/.test(name)) return '';
    return encodeURIComponent(name);
  }

  /** Authorization-only headers for binary media fetch/delete (control-char safe). */
  protected mediaAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (
      this.authToken
      && typeof this.authToken === 'string'
      && !/[\0\r\n]/.test(this.authToken)
      && this.authToken.trim()
    ) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  protected invalidIdResponse<T = unknown>(label = 'id'): ApiResponse<T> {
    return { ok: false, error: `Invalid ${label}` } as ApiResponse<T>;
  }

}
