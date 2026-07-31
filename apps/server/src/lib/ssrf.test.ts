import { describe, expect, it, vi } from 'vitest';
import {
  assertDnsPublic,
  assertSafeOutboundUrl,
  isBlockedIpv4,
  isBlockedSsrfHost,
  isSafeHttpUrlScheme,
  parseHttpUrl,
  SsrfError,
} from './ssrf.js';

describe('isBlockedSsrfHost', () => {
  it('blocks private and metadata hosts', () => {
    expect(isBlockedSsrfHost('127.0.0.1')).toBe(true);
    expect(isBlockedSsrfHost('10.1.2.3')).toBe(true);
    expect(isBlockedSsrfHost('192.168.0.1')).toBe(true);
    expect(isBlockedSsrfHost('169.254.169.254')).toBe(true);
    expect(isBlockedSsrfHost('metadata.google.internal')).toBe(true);
    expect(isBlockedSsrfHost('localhost')).toBe(true);
    expect(isBlockedSsrfHost('example.com')).toBe(false);
  });

  it('blocks control-char hostnames', () => {
    expect(isBlockedSsrfHost('evil\nhost')).toBe(true);
  });
});

describe('parseHttpUrl', () => {
  it('accepts public https', () => {
    const u = parseHttpUrl('https://cdn.example.com/x.png');
    expect(u.hostname).toBe('cdn.example.com');
  });

  it('rejects private host when not allowed', () => {
    expect(() => parseHttpUrl('http://127.0.0.1/secret')).toThrow(SsrfError);
  });

  it('allows private when allowPrivateHost', () => {
    const u = parseHttpUrl('http://127.0.0.1:11434', { allowPrivateHost: true });
    expect(u.port).toBe('11434');
  });

  it('rejects non-http schemes', () => {
    expect(() => parseHttpUrl('file:///etc/passwd')).toThrow(/http/);
  });
});

describe('assertDnsPublic', () => {
  it('rejects DNS results that resolve to private IPs', async () => {
    const lookupFn = vi.fn(async () => [{ address: '10.0.0.5', family: 4 }]) as never;
    await expect(assertDnsPublic('evil.example', { lookupFn })).rejects.toThrow(/blocked/i);
  });

  it('accepts public DNS results', async () => {
    const lookupFn = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) as never;
    await expect(assertDnsPublic('example.com', { lookupFn })).resolves.toBeUndefined();
  });
});

describe('assertSafeOutboundUrl', () => {
  it('blocks private without DNS when host is literal', async () => {
    await expect(assertSafeOutboundUrl('http://192.168.1.1/', { checkDns: false })).rejects.toThrow(
      SsrfError,
    );
  });
});

describe('isSafeHttpUrlScheme', () => {
  it('allows ollama loopback for config', () => {
    expect(isSafeHttpUrlScheme('http://127.0.0.1:11434')).toBe(true);
    expect(isSafeHttpUrlScheme('file:///tmp')).toBe(false);
  });
});

describe('isBlockedIpv4', () => {
  it('flags RFC1918 and link-local', () => {
    expect(isBlockedIpv4(10, 0, 0, 1)).toBe(true);
    expect(isBlockedIpv4(8, 8, 8, 8)).toBe(false);
  });
});
