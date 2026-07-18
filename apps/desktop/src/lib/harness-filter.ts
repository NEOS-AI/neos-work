/** Filter harness list by agent node type (PLAN Task 3 / harness UX). */

export type HarnessLike = {
  id: string;
  name: string;
  domain: string;
};

export function allowedDomainsForAgentNode(nodeType: string): Set<string> {
  if (nodeType === 'agent_finance') return new Set(['finance', 'general']);
  return new Set(['coding', 'general']);
}

export function filterAndSortHarnesses<T extends HarnessLike>(
  harnesses: T[],
  nodeType: string,
): T[] {
  const allowed = allowedDomainsForAgentNode(nodeType);
  return harnesses
    .filter((h) => allowed.has(h.domain))
    .sort((a, b) => `${a.domain}:${a.name}`.localeCompare(`${b.domain}:${b.name}`));
}
