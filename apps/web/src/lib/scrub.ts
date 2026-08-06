/** Scrub untrusted error text for safe UI display. */
export function scrubError(raw: unknown, fallback: string): string {
  const s =
    typeof raw === 'string' && raw
      ? raw
      : raw instanceof Error
        ? raw.message
        : fallback;
  return s.replace(/[\0\r\n]+/g, ' ').slice(0, 300) || fallback;
}
