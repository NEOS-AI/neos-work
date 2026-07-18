/** Format visible/total list counts for filter toolbars. */
export function formatListCount(visible: number, total: number): string {
  const v = Number.isFinite(visible) ? Math.max(0, Math.floor(visible)) : 0;
  const t = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  return `${v}/${t}`;
}
