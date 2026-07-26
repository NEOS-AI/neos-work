/** Filter harness list by agent node type (PLAN Task 3 / harness UX). */

export type HarnessLike = {
  id: string;
  name: string;
  domain: string;
};

function safeDomain(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim().toLowerCase();
}

function safeNodeType(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim();
}

export function allowedDomainsForAgentNode(nodeType: string): Set<string> {
  const t = safeNodeType(nodeType);
  // Unified v2 agent: all built-in packs (PLAN_FOR_V0_4_0)
  if (t === 'agent') {
    return new Set(['finance', 'coding', 'research', 'general']);
  }
  if (t === 'agent_finance') return new Set(['finance', 'general']);
  if (t === 'agent_coding') return new Set(['coding', 'general']);
  // Unknown / control-char → conservative coding+general (legacy default)
  return new Set(['coding', 'general']);
}

export function filterAndSortHarnesses<T extends HarnessLike>(
  harnesses: T[],
  nodeType: string,
): T[] {
  const allowed = allowedDomainsForAgentNode(nodeType);
  return harnesses
    .filter((h) => {
      // Control-char id/name/domain never listed
      if (typeof h.id === 'string' && /[\0\r\n]/.test(h.id)) return false;
      if (typeof h.name === 'string' && /[\0\r\n]/.test(h.name)) return false;
      const domain = safeDomain(h.domain);
      return domain.length > 0 && allowed.has(domain);
    })
    .sort((a, b) => {
      const da = safeDomain(a.domain) || a.domain;
      const db = safeDomain(b.domain) || b.domain;
      const na = typeof a.name === 'string' && !/[\0\r\n]/.test(a.name) ? a.name : '';
      const nb = typeof b.name === 'string' && !/[\0\r\n]/.test(b.name) ? b.name : '';
      return `${da}:${na}`.localeCompare(`${db}:${nb}`);
    });
}
