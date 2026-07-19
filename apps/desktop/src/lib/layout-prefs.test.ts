import { beforeEach, describe, expect, it } from 'vitest';
import {
  EDITOR_RIGHT_PANEL_TABS,
  loadEditorRightPanelTab,
  loadLayoutDirection,
  saveEditorRightPanelTab,
  saveLayoutDirection,
} from './layout-prefs.js';

describe('layout-prefs direction', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to TB', () => {
    expect(loadLayoutDirection()).toBe('TB');
  });

  it('round-trips layout direction', () => {
    saveLayoutDirection('LR');
    expect(loadLayoutDirection()).toBe('LR');
    saveLayoutDirection('TB');
    expect(loadLayoutDirection()).toBe('TB');
  });

  it('ignores invalid stored direction values', () => {
    localStorage.setItem('neos-layout-direction', 'XX');
    expect(loadLayoutDirection()).toBe('TB');
  });
});

describe('layout-prefs right panel tab', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exposes stable tab options', () => {
    expect(EDITOR_RIGHT_PANEL_TABS).toEqual(['config', 'run', 'history', 'preview']);
  });

  it('defaults to config', () => {
    expect(loadEditorRightPanelTab()).toBe('config');
  });

  it('round-trips panel tabs', () => {
    saveEditorRightPanelTab('preview');
    expect(loadEditorRightPanelTab()).toBe('preview');
    saveEditorRightPanelTab('history');
    expect(loadEditorRightPanelTab()).toBe('history');
    saveEditorRightPanelTab('config');
    expect(loadEditorRightPanelTab()).toBe('config');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem('neos-editor-right-panel-tab', 'logs');
    expect(loadEditorRightPanelTab()).toBe('config');
  });
});
