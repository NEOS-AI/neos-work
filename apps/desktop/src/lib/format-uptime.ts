/** Format engine uptime seconds for Dashboard status cards. */
export function formatEngineUptime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.floor(seconds)}s up`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m up`;
  return `${Math.floor(seconds / 3600)}h up`;
}
