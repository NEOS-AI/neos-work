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

function parseDirection(raw: unknown): LayoutDirection | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return v === 'LR' || v === 'TB' ? v : null;
}

export function loadLayoutDirection(): LayoutDirection {
  try {
    return parseDirection(localStorage.getItem(LAYOUT_DIR_KEY)) ?? 'TB';
  } catch {
    return 'TB';
  }
}

export function saveLayoutDirection(direction: LayoutDirection): void {
  try {
    const parsed = parseDirection(direction);
    if (parsed) localStorage.setItem(LAYOUT_DIR_KEY, parsed);
  } catch {
    // ignore quota / private mode
  }
}

const TAB_ALLOWED = new Set<string>(['config', 'run', 'history', 'preview']);

function parseTab(raw: unknown): EditorRightPanelTab | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return TAB_ALLOWED.has(v) ? (v as EditorRightPanelTab) : null;
}

export function loadEditorRightPanelTab(): EditorRightPanelTab {
  try {
    return parseTab(localStorage.getItem(RIGHT_PANEL_TAB_KEY)) ?? 'config';
  } catch {
    return 'config';
  }
}

export function saveEditorRightPanelTab(tab: EditorRightPanelTab): void {
  try {
    const parsed = parseTab(tab);
    if (parsed) localStorage.setItem(RIGHT_PANEL_TAB_KEY, parsed);
  } catch {
    // ignore quota / private mode
  }
}
