import { describe, expect, it } from 'vitest';
import {
  getRuntimeAuthToken,
  getRuntimePort,
  getRuntimeServerUrl,
  setRuntimeContext,
} from './runtime-context.js';

describe('runtime-context', () => {
  it('stores and returns auth token, port, and server URL', () => {
    setRuntimeContext({ authToken: 'secret-token', port: 57286 });
    expect(getRuntimeAuthToken()).toBe('secret-token');
    expect(getRuntimePort()).toBe(57286);
    expect(getRuntimeServerUrl()).toBe('http://127.0.0.1:57286');
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
