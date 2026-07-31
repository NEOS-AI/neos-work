import { describe, expect, it, vi } from 'vitest';
import {
  assertDnsPublic,
  assertSafeOutboundUrl,
  fetchPublicHttp,
  isBlockedIpv4,
  isBlockedSsrfHost,
  isSafeHttpUrlScheme,
  normalizeHttpUrl,
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

describe('normalizeHttpUrl', () => {
  it('adds https and strips trailing slash', () => {
    expect(normalizeHttpUrl('example.com/')).toBe('https://example.com');
    expect(normalizeHttpUrl('http://a.example/path')).toBe('http://a.example/path');
    expect(normalizeHttpUrl('file:///etc/passwd')).toBeUndefined();
  });
});

describe('fetchPublicHttp', () => {
  it('blocks private hosts before fetch', async () => {
    await expect(fetchPublicHttp('http://127.0.0.1/x')).rejects.toThrow(SsrfError);
  });

  it('blocks redirect to private host', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: (h: string) => (h.toLowerCase() === 'location' ? 'http://169.254.169.254/' : null) },
    });
    await expect(
      fetchPublicHttp('https://cdn.example.com/a', { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow(/blocked/i);
  });

  it('returns response for public 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => 'image/png' },
    });
    const res = await fetchPublicHttp('https://cdn.example.com/a.png', {
      fetchImpl: fetchImpl as never,
      followOneRedirect: true,
    });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalled();
  });
});

describe('ssrf additional host/url edges', () => {
  it('isBlockedIpv4 rejects non-octet values and extra ranges', () => {
    expect(isBlockedIpv4(1.5 as unknown as number, 0, 0, 0)).toBe(true);
    expect(isBlockedIpv4(0, 0, 0, 0)).toBe(true);
    expect(isBlockedIpv4(172, 16, 0, 1)).toBe(true);
    expect(isBlockedIpv4(172, 31, 255, 255)).toBe(true);
    expect(isBlockedIpv4(172, 32, 0, 1)).toBe(false);
    expect(isBlockedIpv4(100, 64, 0, 1)).toBe(true);
    expect(isBlockedIpv4(198, 18, 0, 1)).toBe(true);
  });

  it('isBlockedSsrfHost covers bracketed IPv6 and suffixes', () => {
    expect(isBlockedSsrfHost('[::1]')).toBe(true);
    expect(isBlockedSsrfHost('')).toBe(true);
    expect(isBlockedSsrfHost('  ')).toBe(true);
    expect(isBlockedSsrfHost('foo.localhost')).toBe(true);
    expect(isBlockedSsrfHost('box.local')).toBe(true);
    expect(isBlockedSsrfHost('svc.internal')).toBe(true);
    expect(isBlockedSsrfHost('metadata')).toBe(true);
    expect(isBlockedSsrfHost('instance-data')).toBe(true);
    expect(isBlockedSsrfHost('ip-10-0-0-1.compute.internal')).toBe(true);
    expect(isBlockedSsrfHost('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedSsrfHost('fe80::1')).toBe(true);
    expect(isBlockedSsrfHost('fd12::1')).toBe(true);
  });

  it('parseHttpUrl rejects oversize and empty', () => {
    expect(() => parseHttpUrl('')).toThrow(SsrfError);
    expect(() => parseHttpUrl('https://example.com/' + 'a'.repeat(3000))).toThrow(/Invalid URL/);
    expect(() => parseHttpUrl('not a url')).toThrow(SsrfError);
  });

  it('assertDnsPublic rejects invalid host and empty results', async () => {
    await expect(assertDnsPublic('evil\nhost')).rejects.toThrow(/Invalid hostname/);
    await expect(assertDnsPublic('127.0.0.1')).rejects.toThrow(/blocked/i);
    const emptyLookup = vi.fn(async () => []) as never;
    await expect(assertDnsPublic('example.com', { lookupFn: emptyLookup })).rejects.toThrow(
      /no addresses/i,
    );
    const failLookup = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    }) as never;
    await expect(assertDnsPublic('missing.example', { lookupFn: failLookup })).rejects.toThrow(
      /DNS resolution failed/i,
    );
  });

  it('assertSafeOutboundUrl checks DNS by default', async () => {
    const lookupFn = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]) as never;
    const u = await assertSafeOutboundUrl('https://example.com/path', { lookupFn });
    expect(u.hostname).toBe('example.com');
  });

  it('normalizeHttpUrl rejects control and oversize', () => {
    expect(normalizeHttpUrl(123)).toBeUndefined();
    expect(normalizeHttpUrl('bad\nurl')).toBeUndefined();
    expect(normalizeHttpUrl('a'.repeat(3000))).toBeUndefined();
    expect(normalizeHttpUrl('ftp://x.example')).toBeUndefined();
  });

  it('fetchPublicHttp rejects bad Location and multi-redirect', async () => {
    const badLoc = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: () => null },
    });
    await expect(
      fetchPublicHttp('https://cdn.example.com/a', { fetchImpl: badLoc as never }),
    ).rejects.toThrow(/Redirect without usable Location/i);

    const invalidLoc = vi.fn().mockResolvedValue({
      status: 301,
      headers: { get: () => 'http://[' },
    });
    await expect(
      fetchPublicHttp('https://cdn.example.com/a', { fetchImpl: invalidLoc as never }),
    ).rejects.toThrow(/Invalid redirect|Invalid URL/i);

    const multi = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: () => 'https://cdn.example.com/b' },
      })
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: () => 'https://cdn.example.com/c' },
      });
    await expect(
      fetchPublicHttp('https://cdn.example.com/a', { fetchImpl: multi as never }),
    ).rejects.toThrow(/Too many redirects/i);
  });
});
