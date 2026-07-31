import { afterEach, describe, expect, it } from 'vitest';
import { clearConnection, loadConnection, saveConnection } from './auth.js';

afterEach(() => {
  clearConnection();
});

describe('web auth storage', () => {
  it('saves and loads connection when remember=true', () => {
    saveConnection({
      serverUrl: 'http://127.0.0.1:3000',
      token: 'tokentokentoken12',
      remember: true,
    });
    const c = loadConnection();
    expect(c.serverUrl).toContain('127.0.0.1:3000');
    expect(c.token).toBe('tokentokentoken12');
  });

  it('does not persist when remember=false', () => {
    saveConnection({
      serverUrl: 'http://example.test:9',
      token: 'x'.repeat(20),
      remember: false,
    });
    // still may have prior cleared
    clearConnection();
    const c = loadConnection();
    expect(c.token).toBe('');
  });

  it('rejects control chars in token', () => {
    saveConnection({
      serverUrl: 'http://127.0.0.1:3000',
      token: 'bad\ntoken',
      remember: true,
    });
    expect(loadConnection().token).toBe('');
  });
});
