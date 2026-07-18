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
    const trimmed = url.trim();
    if (trimmed) localStorage.setItem(REMOTE_URL_KEY, trimmed);
    else localStorage.removeItem(REMOTE_URL_KEY);
  } catch {
    // ignore quota / private mode
  }
}
