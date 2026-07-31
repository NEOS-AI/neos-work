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

  it('ignores control-char layout/tab storage', () => {
    localStorage.setItem('neos-layout-direction', `LR${'\0'}`);
    expect(loadLayoutDirection()).toBe('TB');
    localStorage.setItem('neos-layout-direction', '  LR  ');
    expect(loadLayoutDirection()).toBe('LR');
    localStorage.setItem('neos-editor-right-panel-tab', '\nhistory');
    expect(loadEditorRightPanelTab()).toBe('config');
  });

});

describe('layout-prefs storage failures', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('load falls back when getItem throws', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      expect(loadLayoutDirection()).toBe('TB');
      expect(loadEditorRightPanelTab()).toBe('config');
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  it('save ignores setItem failures and invalid values', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(() => saveLayoutDirection('LR')).not.toThrow();
      expect(() => saveEditorRightPanelTab('run')).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
    // invalid cast values are ignored without write
    saveLayoutDirection('ZZ' as 'TB');
    expect(loadLayoutDirection()).toBe('TB');
    saveEditorRightPanelTab('nope' as 'config');
    expect(loadEditorRightPanelTab()).toBe('config');
  });
});
