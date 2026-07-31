import { describe, expect, it } from 'vitest';
import { resolveConfig, formatServerLabel } from './config.js';

describe('resolveConfig', () => {
  it('defaults to localhost:3000', () => {
    const c = resolveConfig({});
    expect(c.serverUrl).toBe('http://127.0.0.1:3000');
    expect(c.authToken).toBeNull();
  });

  it('reads NEOS_SERVER_URL and token aliases', () => {
    const c = resolveConfig({
      NEOS_SERVER_URL: 'http://localhost:4000/',
      NEOS_TOKEN: 'abc',
      NEOS_PROJECT_ID: 'p1',
    });
    expect(c.serverUrl).toBe('http://localhost:4000');
    expect(c.authToken).toBe('abc');
    expect(c.projectId).toBe('p1');
    expect(formatServerLabel(c)).toContain('localhost:4000');
  });

  it('rejects control-char env values', () => {
    const c = resolveConfig({
      NEOS_AUTH_TOKEN: 'bad\ntoken',
      NEOS_SERVER_URL: 'http://x\n.com',
    });
    expect(c.authToken).toBeNull();
    expect(c.serverUrl).toBe('http://127.0.0.1:3000');
  });

  it('uses NEOS_PORT when URL unset', () => {
    const c = resolveConfig({ NEOS_PORT: '9876' });
    expect(c.serverUrl).toBe('http://127.0.0.1:9876');
  });
});
