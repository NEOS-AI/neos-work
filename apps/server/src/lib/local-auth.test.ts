import { afterEach, describe, expect, it } from 'vitest';
import {
  decideLocalAuth,
  isLocalAuthDisabled,
  isLoopbackHostHeader,
  isLoopbackIp,
} from './local-auth.js';

describe('isLoopbackIp', () => {
  it('accepts IPv4 / IPv6 / mapped loopback', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true);
    expect(isLoopbackIp('127.1.2.3')).toBe(true);
    expect(isLoopbackIp('::1')).toBe(true);
    expect(isLoopbackIp('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackIp('  127.0.0.1  ')).toBe(true);
  });

  it('rejects non-loopback and junk', () => {
    expect(isLoopbackIp('0.0.0.0')).toBe(false);
    expect(isLoopbackIp('192.168.1.10')).toBe(false);
    expect(isLoopbackIp('10.0.0.1')).toBe(false);
    expect(isLoopbackIp('8.8.8.8')).toBe(false);
    expect(isLoopbackIp('127.0.0.1.evil')).toBe(false);
    expect(isLoopbackIp('127.0.0.1\n')).toBe(false);
    expect(isLoopbackIp('')).toBe(false);
    expect(isLoopbackIp(null)).toBe(false);
  });
});

describe('isLoopbackHostHeader', () => {
  it('accepts localhost / 127.0.0.1 / ::1 with optional port', () => {
    expect(isLoopbackHostHeader('localhost')).toBe(true);
    expect(isLoopbackHostHeader('localhost:57286')).toBe(true);
    expect(isLoopbackHostHeader('127.0.0.1')).toBe(true);
    expect(isLoopbackHostHeader('127.0.0.1:57286')).toBe(true);
    expect(isLoopbackHostHeader('[::1]')).toBe(true);
    expect(isLoopbackHostHeader('[::1]:57286')).toBe(true);
  });

  it('rejects remote hosts and control chars', () => {
    expect(isLoopbackHostHeader('example.com')).toBe(false);
    expect(isLoopbackHostHeader('example.com:80')).toBe(false);
    expect(isLoopbackHostHeader('192.168.1.10:57286')).toBe(false);
    expect(isLoopbackHostHeader('127.0.0.1\n')).toBe(false);
    expect(isLoopbackHostHeader('')).toBe(false);
    expect(isLoopbackHostHeader(undefined)).toBe(false);
  });
});

describe('decideLocalAuth', () => {
  const ok = {
    remoteAddress: '127.0.0.1',
    host: '127.0.0.1:57286',
    token: 'a'.repeat(32),
  };

  it('returns the token for loopback requests', () => {
    expect(decideLocalAuth(ok)).toEqual({ status: 200, token: ok.token });
  });

  it('forbids remote address even with a loopback Host', () => {
    expect(decideLocalAuth({ ...ok, remoteAddress: '203.0.113.4' })).toEqual({
      status: 403,
      error: 'Forbidden',
    });
  });

  it('forbids loopback address with a remote Host (DNS rebinding)', () => {
    expect(decideLocalAuth({ ...ok, host: 'evil.example' })).toEqual({
      status: 403,
      error: 'Forbidden',
    });
  });

  it('forbids when disabled', () => {
    expect(decideLocalAuth({ ...ok, disabled: true })).toEqual({
      status: 403,
      error: 'Local auth bootstrap is disabled',
    });
  });

  it('returns 503 when token is missing or too short', () => {
    expect(decideLocalAuth({ ...ok, token: '' }).status).toBe(503);
    expect(decideLocalAuth({ ...ok, token: 'short' }).status).toBe(503);
  });
});

describe('isLocalAuthDisabled', () => {
  const prev = process.env.NEOS_LOCAL_AUTH;
  afterEach(() => {
    if (prev === undefined) delete process.env.NEOS_LOCAL_AUTH;
    else process.env.NEOS_LOCAL_AUTH = prev;
  });

  it('reads NEOS_LOCAL_AUTH=0/false', () => {
    expect(isLocalAuthDisabled({})).toBe(false);
    expect(isLocalAuthDisabled({ NEOS_LOCAL_AUTH: '0' })).toBe(true);
    expect(isLocalAuthDisabled({ NEOS_LOCAL_AUTH: 'false' })).toBe(true);
    expect(isLocalAuthDisabled({ NEOS_LOCAL_AUTH: '1' })).toBe(false);
  });
});
