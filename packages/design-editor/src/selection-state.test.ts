import { describe, expect, it } from 'vitest';
import {
  createEmptySelection,
  editContextFromSelection,
  selectionEquals,
  selectionFromBridge,
  selectionFromLayer,
} from './selection-state.js';

describe('selection-state', () => {
  it('createEmptySelection is null', () => {
    expect(createEmptySelection()).toBeNull();
  });

  it('selectionFromLayer and selectionFromBridge', () => {
    const layer = selectionFromLayer('index.html', { id: 'l1', selector: 'h1' });
    expect(layer).toEqual({
      filePath: 'index.html',
      selector: 'h1',
      layerId: 'l1',
    });

    const bridge = selectionFromBridge(
      'index.html',
      { selector: '.hero', tagName: 'div' } as never,
      'layer-2',
    );
    expect(bridge.selector).toBe('.hero');
    expect(bridge.layerId).toBe('layer-2');
  });

  it('selectionEquals compares file/selector/layer', () => {
    expect(selectionEquals(null, null)).toBe(true);
    expect(selectionEquals(null, { filePath: 'a', selector: 'x' })).toBe(false);
    expect(
      selectionEquals(
        { filePath: 'a', selector: 'h1', layerId: '1' },
        { filePath: 'a', selector: 'h1', layerId: '1' },
      ),
    ).toBe(true);
    expect(
      selectionEquals(
        { filePath: 'a', selector: 'h1' },
        { filePath: 'a', selector: 'h2' },
      ),
    ).toBe(false);
    expect(
      selectionEquals(
        { filePath: 'a', selector: 'h1', layerId: '1' },
        { filePath: 'a', selector: 'h1', layerId: '2' },
      ),
    ).toBe(false);
  });

  it('editContextFromSelection defaults replace-selection', () => {
    const ctx = editContextFromSelection(
      { filePath: 'x.html', selector: '.btn' },
      { snippet: '<button>Go</button>' },
    );
    expect(ctx.mode).toBe('replace-selection');
    expect(ctx.selection).toEqual({ selector: '.btn' });
    expect(ctx.snippet).toContain('button');

    const noSel = editContextFromSelection(
      { filePath: 'x.html' },
      { mode: 'patch' },
    );
    expect(noSel.mode).toBe('patch');
    expect(noSel.selection).toBeUndefined();
  });
});
