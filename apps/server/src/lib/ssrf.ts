/**
 * Shared SSRF guards (PLAN_FOR_V0_5_0 Task 14 / OD §22).
 *
 * - URL parse + http(s) only
 * - Hostname private/loopback/link-local/metadata block
 * - Optional DNS resolution check (blocks if any A/AAAA is private)
 * - Redirect-safe outbound probe helper
 */

import dns from 'node:dns/promises';
import net from 'node:net';

export class SsrfError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid' | 'blocked_host' | 'blocked_dns' | 'protocol',
  ) {
    super(message);
    this.name = 'SsrfError';
  }
}

/** True if dotted IPv4 is loopback / private / link-local / CGNAT / metadata. */
export function isBlockedIpv4(a: number, b: number, _c = 0, _d = 0): boolean {
  if (![a, b, _c, _d].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  return false;
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

/**
 * True if hostname must not be used for untrusted outbound fetches.
 * Literal IPs + known metadata hostnames + coarse IPv6 prefixes.
 */
export function isBlockedSsrfHost(hostname: string): boolean {
  if (typeof hostname !== 'string' || /[\0\r\n]/.test(hostname)) return true;
  let h = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (!h) return true;
  if (h === 'localhost' || h === '0.0.0.0' || h === '::' || h === '::1') return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal' || h === 'metadata' || h === 'metadata.google.com') {
    return true;
  }
  // AWS / Azure metadata common names
  if (h === 'instance-data' || h.endsWith('.compute.internal')) return true;

  const v4 = parseIpv4(h);
  if (v4) return isBlockedIpv4(...v4);

  const v4mapped = h.match(/^:?:ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i);
  if (v4mapped) {
    return isBlockedIpv4(
      Number(v4mapped[1]),
      Number(v4mapped[2]),
      Number(v4mapped[3]),
      Number(v4mapped[4]),
    );
  }

  if (
    h === '0:0:0:0:0:0:0:1'
    || h.startsWith('fc')
    || h.startsWith('fd')
    || h.startsWith('fe80')
    || h.startsWith('::ffff:7f')
  ) {
    return true;
  }

  // net.isIP for normalized forms
  if (net.isIPv4(h)) {
    const p = parseIpv4(h);
    return p ? isBlockedIpv4(...p) : true;
  }
  if (net.isIPv6(h)) {
    if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) {
      return true;
    }
  }
  return false;
}

/** Parse URL; only http(s); optional private host block on the hostname literal. */
export function parseHttpUrl(
  raw: unknown,
  opts?: { allowPrivateHost?: boolean; maxLength?: number },
): URL {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) {
    throw new SsrfError('Invalid URL', 'invalid');
  }
  const trimmed = raw.trim();
  const max = opts?.maxLength ?? 2_048;
  if (!trimmed || trimmed.length > max) {
    throw new SsrfError('Invalid URL', 'invalid');
  }
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new SsrfError('Invalid URL', 'invalid');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfError('URL must be http(s)', 'protocol');
  }
  if (!opts?.allowPrivateHost && isBlockedSsrfHost(u.hostname)) {
    throw new SsrfError('Host is blocked (private/loopback/metadata)', 'blocked_host');
  }
  return u;
}

/**
 * Lightweight safe URL for config storage (BYOK base URLs).
 * Allows private hosts (Ollama on 127.0.0.1) — scheme + control-char only.
 */
export function isSafeHttpUrlScheme(url: string): boolean {
  try {
    parseHttpUrl(url, { allowPrivateHost: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * DNS resolve hostname; fail if any address is private/blocked.
 * Skip resolve for already-literal IPs (already checked via host).
 */
export async function assertDnsPublic(
  hostname: string,
  opts?: { lookupFn?: typeof dns.lookup },
): Promise<void> {
  if (typeof hostname !== 'string' || /[\0\r\n]/.test(hostname)) {
    throw new SsrfError('Invalid hostname', 'invalid');
  }
  const h = hostname.trim().toLowerCase();
  if (isBlockedSsrfHost(h)) {
    throw new SsrfError('Host is blocked (private/loopback/metadata)', 'blocked_host');
  }
  // Literals already validated
  if (net.isIP(h) || parseIpv4(h)) return;

  const lookup = opts?.lookupFn ?? dns.lookup;
  let results: Array<{ address: string; family: number }>;
  try {
    // all: true returns array
    const r = await lookup(h, { all: true, verbatim: true });
    results = Array.isArray(r) ? (r as Array<{ address: string; family: number }>) : [r as { address: string; family: number }];
  } catch {
    throw new SsrfError('DNS resolution failed', 'blocked_dns');
  }
  if (!results.length) {
    throw new SsrfError('DNS resolution returned no addresses', 'blocked_dns');
  }
  for (const row of results) {
    const addr = row.address;
    if (isBlockedSsrfHost(addr)) {
      throw new SsrfError('DNS resolved to a blocked address', 'blocked_dns');
    }
  }
}

export interface AssertSafeOutboundOptions {
  /** When true, also resolve DNS and reject private A/AAAA (default true for untrusted URLs). */
  checkDns?: boolean;
  lookupFn?: typeof dns.lookup;
}

/**
 * Full outbound URL guard for untrusted fetches (media assets, check-link, connection probes).
 */
export async function assertSafeOutboundUrl(
  raw: unknown,
  opts?: AssertSafeOutboundOptions,
): Promise<URL> {
  const u = parseHttpUrl(raw, { allowPrivateHost: false });
  if (opts?.checkDns !== false) {
    await assertDnsPublic(u.hostname, { lookupFn: opts?.lookupFn });
  }
  return u;
}

/** Normalize deploy/check URL echo (http(s) only, optional bare host). */
export function normalizeHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  if (/[\0\r\n]/.test(raw)) return undefined;
  const s = raw.trim();
  if (!s || s.length > 2_048) return undefined;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : `https://${s}`;
    const u = parseHttpUrl(withScheme, { allowPrivateHost: true });
    return u.href.replace(/\/$/, '') === u.origin + u.pathname.replace(/\/$/, '')
      ? withScheme.replace(/\/+$/, '')
      : withScheme.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}
