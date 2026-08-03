/**
 * Normalize a project-relative path for lock/selection/file keys.
 * Mirrors server normalizeLockPath: posix slashes, strip leading /, reject traversal/absolute.
 */
export function normalizeProjectRelPath(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const p = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || p.length > 500) return '';
  if (p.includes('..')) return '';
  if (p.startsWith('~/') || /^[A-Za-z]:\//.test(p)) return '';
  return p;
}
