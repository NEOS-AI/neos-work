/** Persist WorkflowEditor auto-layout direction (PLAN Task 15). */

const LAYOUT_DIR_KEY = 'neos-layout-direction';

export type LayoutDirection = 'TB' | 'LR';

export function loadLayoutDirection(): LayoutDirection {
  try {
    const v = localStorage.getItem(LAYOUT_DIR_KEY);
    return v === 'LR' ? 'LR' : 'TB';
  } catch {
    return 'TB';
  }
}

export function saveLayoutDirection(direction: LayoutDirection): void {
  try {
    if (direction === 'TB' || direction === 'LR') {
      localStorage.setItem(LAYOUT_DIR_KEY, direction);
    }
  } catch {
    // ignore quota / private mode
  }
}
