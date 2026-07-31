/**
 * Browser token UX (Task 12).
 * Token is never logged; stored in localStorage when user opts in.
 */

const KEY_URL = 'neos.web.serverUrl';
const KEY_TOKEN = 'neos.web.authToken';

function clean(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim();
}

export function loadConnection(): { serverUrl: string; token: string } {
  try {
    const serverUrl = clean(localStorage.getItem(KEY_URL)) || defaultServerUrl();
    const token = clean(localStorage.getItem(KEY_TOKEN));
    return { serverUrl, token };
  } catch {
    return { serverUrl: defaultServerUrl(), token: '' };
  }
}

export function saveConnection(input: { serverUrl: string; token: string; remember: boolean }): void {
  const serverUrl = clean(input.serverUrl) || defaultServerUrl();
  const token = clean(input.token);
  try {
    if (input.remember) {
      localStorage.setItem(KEY_URL, serverUrl);
      if (token) localStorage.setItem(KEY_TOKEN, token);
      else localStorage.removeItem(KEY_TOKEN);
    } else {
      localStorage.removeItem(KEY_URL);
      localStorage.removeItem(KEY_TOKEN);
    }
  } catch {
    // private mode
  }
}

export function clearConnection(): void {
  try {
    localStorage.removeItem(KEY_URL);
    localStorage.removeItem(KEY_TOKEN);
  } catch {
    // ignore
  }
}

/** Same-origin when served by daemon; otherwise localhost:3000 for vite proxy. */
export function defaultServerUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    // When opened from Vite dev, API is proxied on same origin
    if (window.location.port === '5173') return window.location.origin;
    // Static serve from daemon: same origin
    return window.location.origin;
  }
  return 'http://127.0.0.1:3000';
}
