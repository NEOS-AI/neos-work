/**
 * Paths that skip Bearer auth (public probes / browser redirects).
 * Kept separate from index.ts so unit tests do not boot the HTTP server.
 */

/**
 * True when `pathname` must not require the daemon AUTH_TOKEN Bearer.
 * - Health: public probe
 * - Webhook *trigger* only (`/api/webhook/:id`): HMAC-SHA256 (not secret/admin subpaths)
 * - Tool routes: short-lived tool tokens
 * - OAuth callback: state/PKCE-bound (browser redirect cannot attach Bearer)
 */
export function isAuthExemptPath(pathname: string): boolean {
  if (typeof pathname !== 'string' || /[\0\r\n]/.test(pathname)) return false;
  let p = pathname.trim();
  if (!p) return false;
  // Normalize trailing slash so /api/webhook/:id/ still matches trigger-only rule
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  // Health check (connection probing before token is known)
  if (p === '/api/health') return true;
  // Webhook *trigger* only (/api/webhook/:id) uses HMAC-SHA256 — no Bearer.
  // Admin ops (secret, regenerate, rate-limit) stay Bearer-protected so the
  // HMAC secret is not world-readable under the same prefix.
  if (p.startsWith('/api/webhook/')) {
    const rest = p.slice('/api/webhook/'.length);
    // Exactly one segment (workflow id); extra segments are admin routes
    if (rest && !rest.includes('/')) return true;
    return false;
  }
  // Tool-token routes validate agent tool tokens themselves (Task 9)
  if (p.startsWith('/api/tools/')) return true;
  // MCP OAuth provider browser redirect — protected by PKCE `state`, not Bearer
  // Mounted at /api/mcp-servers; allow documented /api/mcp alias path too
  if (
    p === '/api/mcp-servers/oauth/callback'
    || p === '/api/mcp/oauth/callback'
  ) {
    return true;
  }
  return false;
}
