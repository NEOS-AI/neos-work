/** Pick the N most recently updated workflows for dashboard shortcuts. */

export interface RecentWorkflowLike {
  id: string;
  name: string;
  domain: string;
  updatedAt: string;
  nodes?: unknown[];
  edges?: unknown[];
}

export function pickRecentWorkflows<T extends RecentWorkflowLike>(
  workflows: T[],
  limit = 5,
): T[] {
  const n = Math.max(0, Math.floor(limit));
  if (n === 0 || workflows.length === 0) return [];
  return [...workflows]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, n);
}
