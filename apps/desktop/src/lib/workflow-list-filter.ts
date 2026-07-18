/**
 * Client-side workflow list filter (search + domain).
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
