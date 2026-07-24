/**
 * Safe media filename validation for /api/media/file routes and listing.
 */

/** Alphanumeric, underscore, hyphen, dot only (no path separators). */
export function isSafeMediaFilename(filename: string): boolean {
  const name = typeof filename === 'string' ? filename.trim() : '';
  if (!name || name === '.' || name === '..') return false;
  // Disallow leading dots (hidden) to match listMedia filters
  if (name.startsWith('.')) return false;
  return /^[a-zA-Z0-9_\-.]+$/.test(name);
}
