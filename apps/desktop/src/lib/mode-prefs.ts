/** Persist ModeSelection client connection preferences. */

const REMOTE_URL_KEY = 'neos-remote-url';

export function loadRemoteUrl(): string {
  try {
    return localStorage.getItem(REMOTE_URL_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveRemoteUrl(url: string): void {
  try {
    // Control-char URLs are never persisted (check before trim)
    if (typeof url !== 'string' || /[\0\r\n]/.test(url)) {
      localStorage.removeItem(REMOTE_URL_KEY);
      return;
    }
    const trimmed = url.trim();
    // Only store http(s) remote endpoints (align with server safe URL hygiene)
    if (trimmed) {
      try {
        const u = new URL(trimmed);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          localStorage.removeItem(REMOTE_URL_KEY);
          return;
        }
      } catch {
        localStorage.removeItem(REMOTE_URL_KEY);
        return;
      }
      localStorage.setItem(REMOTE_URL_KEY, trimmed);
    } else {
      localStorage.removeItem(REMOTE_URL_KEY);
    }
  } catch {
    // ignore quota / private mode
  }
}
