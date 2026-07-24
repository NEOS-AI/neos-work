import { describe, expect, it } from 'vitest';
import {
  getRuntimeAuthToken,
  getRuntimePort,
  getRuntimeServerUrl,
  normalizeListenPort,
  setRuntimeContext,
} from './runtime-context.js';

describe('runtime-context', () => {
  it('stores and returns auth token, port, and server URL', () => {
    setRuntimeContext({ authToken: 'secret-token', port: 57286 });
    expect(getRuntimeAuthToken()).toBe('secret-token');
    expect(getRuntimePort()).toBe(57286);
    expect(getRuntimeServerUrl()).toBe('http://127.0.0.1:57286');
  });

  it('trims auth token and clamps invalid ports', () => {
    setRuntimeContext({ authToken: '  tok  ', port: 8080 });
    expect(getRuntimeAuthToken()).toBe('tok');
    expect(normalizeListenPort(0)).toBe(3000);
    expect(normalizeListenPort(70000)).toBe(3000);
    expect(normalizeListenPort(NaN)).toBe(3000);
    expect(normalizeListenPort(443)).toBe(443);
    expect(normalizeListenPort('  9000  ')).toBe(9000);

    setRuntimeContext({ authToken: 'x', port: 99999 });
    // Invalid port falls back to previous valid port
    expect(getRuntimePort()).toBe(8080);
  });
});

describe('runtime-context updates', () => {
  it('overwrites previous context values', () => {
    setRuntimeContext({ authToken: 'a', port: 1 });
    setRuntimeContext({ authToken: 'b', port: 9999 });
    expect(getRuntimeAuthToken()).toBe('b');
    expect(getRuntimePort()).toBe(9999);
    expect(getRuntimeServerUrl()).toBe('http://127.0.0.1:9999');
  });
});
