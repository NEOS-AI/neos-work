/** Persist Workflows list sort mode (PLAN Task 10 / UX polish). */

const SORT_KEY = 'neos-workflows-sort';

export type WorkflowListSortMode = 'updated' | 'name';

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
