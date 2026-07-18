/**
 * Client-side list filters (search + optional domain/status).
 */

export interface WorkflowListItem {
  name: string;
  description?: string;
  domain: string;
}

export function filterWorkflowList<T extends WorkflowListItem>(
  items: T[],
  options: { search?: string; domain?: string },
): T[] {
  const domain = options.domain && options.domain !== 'all' ? options.domain : null;
  const q = options.search?.trim().toLowerCase() ?? '';
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
  const q = search?.trim().toLowerCase() ?? '';
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
  if (!status || status === 'all') return items;
  return items.filter((item) => item.status === status);
}

/** Filter media files (or similar) by kind chip. */
export function filterByKind<T extends { kind: string }>(
  items: T[],
  kind?: string,
): T[] {
  if (!kind || kind === 'all') return items;
  return items.filter((item) => item.kind === kind);
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
  const q = search?.trim().toLowerCase() ?? '';
  if (!q) return items;
  return items.filter((item) => getHaystack(item).toLowerCase().includes(q));
}
