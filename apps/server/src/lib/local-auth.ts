/**
 * Loopback-only host-mode bootstrap.
 * Same-machine clients (desktop Host mode) can fetch the daemon Bearer token
 * without pasting NEOS_AUTH_TOKEN from logs. Remote clients must still
 * present a token — this never trusts X-Forwarded-For / X-Real-IP.
 */

const IPV4_LOOPBACK = /^127(?:\.(?:\d{1,3})){3}$/;
const IPV4_MAPPED_LOOPBACK = /^::ffff:127(?:\.(?:\d{1,3})){3}$/i;

/** True when `addr` is IPv4/IPv6 loopback. Fail closed on junk. */
export function isLoopbackIp(addr: unknown): boolean {
  if (typeof addr !== 'string' || /[\0\r\n]/.test(addr)) return false;
  const a = addr.trim().toLowerCase();
  if (!a) return false;
  if (a === '::1' || a === 'localhost') return true;
  if (IPV4_LOOPBACK.test(a)) return true;
  if (IPV4_MAPPED_LOOPBACK.test(a)) return true;
  return false;
}

/** True when Host is localhost / 127.0.0.1 / ::1 (optional port). */
export function isLoopbackHostHeader(host: unknown): boolean {
  if (typeof host !== 'string' || /[\0\r\n]/.test(host)) return false;
  const raw = host.trim().toLowerCase();
  if (!raw) return false;
  let name = raw;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    if (end < 1) return false;
    name = raw.slice(1, end);
  } else {
    const colon = raw.lastIndexOf(':');
    // IPv6 without brackets is not a valid Host; treat bare names + IPv4:port
    name = colon > -1 && raw.includes('.') ? raw.slice(0, colon) : raw;
    if (colon > -1 && !raw.includes('.')) {
      // localhost:port
      name = raw.slice(0, colon);
    }
  }
  return name === 'localhost' || name === '127.0.0.1' || name === '::1';
}

export function isLocalAuthDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = env.NEOS_LOCAL_AUTH;
  return v === '0' || v === 'false';
}

export type LocalAuthDecision =
  | { status: 200; token: string }
  | { status: 403; error: string }
  | { status: 503; error: string };

/**
 * Decide whether to hand out the daemon token.
 * Requires loopback remote + loopback Host + a usable token.
 */
export function decideLocalAuth(input: {
  remoteAddress: unknown;
  host: unknown;
  token: string;
  disabled?: boolean;
}): LocalAuthDecision {
  if (input.disabled) {
    return { status: 403, error: 'Local auth bootstrap is disabled' };
  }
  if (!isLoopbackIp(input.remoteAddress) || !isLoopbackHostHeader(input.host)) {
    return { status: 403, error: 'Forbidden' };
  }
  const token = typeof input.token === 'string' ? input.token : '';
  if (!token || /[\0\r\n]/.test(token) || token.trim().length < 16) {
    return { status: 503, error: 'Auth token unavailable' };
  }
  return { status: 200, token };
}
