/** Persist WorkflowEditor layout + right panel tab (PLAN Task 4 / 15 polish). */

const LAYOUT_DIR_KEY = 'neos-layout-direction';
const RIGHT_PANEL_TAB_KEY = 'neos-editor-right-panel-tab';

export type LayoutDirection = 'TB' | 'LR';

export type EditorRightPanelTab = 'config' | 'run' | 'history' | 'preview';

export const EDITOR_RIGHT_PANEL_TABS: readonly EditorRightPanelTab[] = [
  'config',
  'run',
  'history',
  'preview',
] as const;

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

export function loadEditorRightPanelTab(): EditorRightPanelTab {
  try {
    const v = localStorage.getItem(RIGHT_PANEL_TAB_KEY);
    if (v === 'config' || v === 'run' || v === 'history' || v === 'preview') return v;
    return 'config';
  } catch {
    return 'config';
  }
}

export function saveEditorRightPanelTab(tab: EditorRightPanelTab): void {
  try {
    if (tab === 'config' || tab === 'run' || tab === 'history' || tab === 'preview') {
      localStorage.setItem(RIGHT_PANEL_TAB_KEY, tab);
    }
  } catch {
    // ignore quota / private mode
  }
}
