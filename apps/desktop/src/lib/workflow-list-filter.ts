/**
 * Client-side list filters (search + optional domain/status).
 */

export interface WorkflowListItem {
  name: string;
  description?: string;
  domain: string;
}

/** Normalize free-text search; control-char queries are ignored (return all). */
function normalizeSearchQuery(search?: string): string {
  if (typeof search !== 'string' || /[\0\r\n]/.test(search)) return '';
  return search.trim().toLowerCase();
}

/** Normalize domain/status chip; control-char filters ignored (return all). */
function normalizeChipFilter(raw?: string): string | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  if (!v || v === 'all') return null;
  return v;
}

export function filterWorkflowList<T extends WorkflowListItem>(
  items: T[],
  options: { search?: string; domain?: string },
): T[] {
  const domain = normalizeChipFilter(options.domain);
  const q = normalizeSearchQuery(options.search);
  return items.filter((wf) => {
    if (domain && wf.domain !== domain) return false;
    if (!q) return true;
    return (
      wf.name.toLowerCase().includes(q)
      || (wf.description ?? '').toLowerCase().includes(q)
    );
  });
}

/** Generic name/description search for plugins, skills, etc. */
export function filterBySearchText<T extends { name: string; description?: string | null }>(
  items: T[],
  search?: string,
): T[] {
  const q = normalizeSearchQuery(search);
  if (!q) return items;
  return items.filter(
    (item) =>
      item.name.toLowerCase().includes(q)
      || (item.description ?? '').toLowerCase().includes(q),
  );
}

/** Filter deployments by status chip. */
export function filterByStatus<T extends { status: string }>(
  items: T[],
  status?: string,
): T[] {
  const s = normalizeChipFilter(status);
  if (!s) return items;
  return items.filter((item) => item.status === s);
}

/** Filter media files (or similar) by kind chip. */
export function filterByKind<T extends { kind: string }>(
  items: T[],
  kind?: string,
): T[] {
  const k = normalizeChipFilter(kind);
  if (!k) return items;
  return items.filter((item) => item.kind === k);
}

/**
 * Filter by enabled flag (routines, skills, etc.).
 * `enabledFilter`: 'all' | 'enabled' | 'disabled'
 */
export function filterByEnabled<T extends { enabled: boolean }>(
  items: T[],
  enabledFilter?: string,
): T[] {
  if (!enabledFilter || enabledFilter === 'all') return items;
  if (enabledFilter === 'enabled') return items.filter((item) => item.enabled);
  if (enabledFilter === 'disabled') return items.filter((item) => !item.enabled);
  return items;
}

/** Free-text match against a derived haystack (deployments, multi-field search). */
export function filterByTextMatch<T>(
  items: T[],
  search: string | undefined,
  getHaystack: (item: T) => string,
): T[] {
  const q = normalizeSearchQuery(search);
  if (!q) return items;
  return items.filter((item) => getHaystack(item).toLowerCase().includes(q));
}

/** Filter by a string field chip (e.g. deployment provider). */
export function filterByFieldValue<T>(
  items: T[],
  field: keyof T & string,
  value?: string,
): T[] {
  const v = normalizeChipFilter(value);
  if (!v) return items;
  return items.filter((item) => String(item[field] ?? '') === v);
}
