/**
 * Deploy project name constraints (Vercel / Cloudflare Pages simplified).
 * Single source of truth for desktop graph validation, server routes, and DeployNode.
 */

/** Start with alnum, then alnum/hyphen/underscore (max 63 chars total). */
export function isValidDeployProjectName(name: string): boolean {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(n);
}
