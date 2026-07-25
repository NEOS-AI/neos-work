/** Persist Workflows list sort / domain filter (PLAN Task 10 / UX polish). */

const SORT_KEY = 'neos-workflows-sort';
const DOMAIN_KEY = 'neos-workflows-domain';

export type WorkflowListSortMode = 'updated' | 'name';
export type WorkflowListDomainFilter = 'all' | 'finance' | 'coding' | 'general';

function parseSort(raw: unknown): WorkflowListSortMode | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return v === 'name' || v === 'updated' ? v : null;
}

export function loadWorkflowListSort(): WorkflowListSortMode {
  try {
    return parseSort(localStorage.getItem(SORT_KEY)) ?? 'updated';
  } catch {
    return 'updated';
  }
}

export function saveWorkflowListSort(mode: WorkflowListSortMode): void {
  try {
    const parsed = parseSort(mode);
    if (parsed) localStorage.setItem(SORT_KEY, parsed);
  } catch {
    // ignore quota / private mode
  }
}

const DOMAIN_ALLOWED = new Set<string>(['all', 'finance', 'coding', 'general']);

function parseDomain(raw: unknown): WorkflowListDomainFilter | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return DOMAIN_ALLOWED.has(v) ? (v as WorkflowListDomainFilter) : null;
}

export function loadWorkflowListDomain(): WorkflowListDomainFilter {
  try {
    return parseDomain(localStorage.getItem(DOMAIN_KEY)) ?? 'all';
  } catch {
    return 'all';
  }
}

export function saveWorkflowListDomain(domain: WorkflowListDomainFilter): void {
  try {
    const parsed = parseDomain(domain);
    if (parsed) localStorage.setItem(DOMAIN_KEY, parsed);
  } catch {
    // ignore quota / private mode
  }
}
