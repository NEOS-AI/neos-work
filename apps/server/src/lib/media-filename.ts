/**
 * Safe media filename validation for /api/media/file routes and listing.
 */

/** Cap media filename length (path segment hygiene). */
export const MEDIA_FILENAME_MAX_CHARS = 200;

/** Alphanumeric, underscore, hyphen, dot only (no path separators). */
export function isSafeMediaFilename(filename: string): boolean {
  const name = typeof filename === 'string' ? filename.trim() : '';
  if (!name || name === '.' || name === '..') return false;
  // Disallow leading dots (hidden) to match listMedia filters
  if (name.startsWith('.')) return false;
  if (name.length > MEDIA_FILENAME_MAX_CHARS) return false;
  return /^[a-zA-Z0-9_\-.]+$/.test(name);
}
