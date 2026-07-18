/** Persist Workflows list sort / domain filter (PLAN Task 10 / UX polish). */

const SORT_KEY = 'neos-workflows-sort';
const DOMAIN_KEY = 'neos-workflows-domain';

export type WorkflowListSortMode = 'updated' | 'name';
export type WorkflowListDomainFilter = 'all' | 'finance' | 'coding' | 'general';

export function loadWorkflowListSort(): WorkflowListSortMode {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === 'name' ? 'name' : 'updated';
  } catch {
    return 'updated';
  }
}

export function saveWorkflowListSort(mode: WorkflowListSortMode): void {
  try {
    if (mode === 'updated' || mode === 'name') {
      localStorage.setItem(SORT_KEY, mode);
    }
  } catch {
    // ignore quota / private mode
  }
}

export function loadWorkflowListDomain(): WorkflowListDomainFilter {
  try {
    const v = localStorage.getItem(DOMAIN_KEY);
    if (v === 'finance' || v === 'coding' || v === 'general' || v === 'all') return v;
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveWorkflowListDomain(domain: WorkflowListDomainFilter): void {
  try {
    if (domain === 'all' || domain === 'finance' || domain === 'coding' || domain === 'general') {
      localStorage.setItem(DOMAIN_KEY, domain);
    }
  } catch {
    // ignore quota / private mode
  }
}
