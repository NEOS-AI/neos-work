/** Persist ModeSelection client connection preferences. */

const REMOTE_URL_KEY = 'neos-remote-url';

export function loadRemoteUrl(): string {
  try {
    const raw = localStorage.getItem(REMOTE_URL_KEY) ?? '';
    // Control-char / non-http stored values ignored (align with save)
    if (!raw || /[\0\r\n]/.test(raw)) return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    try {
      const u = new URL(trimmed);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    } catch {
      return '';
    }
    return trimmed;
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
