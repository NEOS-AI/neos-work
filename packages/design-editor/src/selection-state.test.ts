import { describe, expect, it } from 'vitest';
import {
  bboxesFromMultiEntries,
  createEmptySelection,
  editContextFromSelection,
  multiEntriesFromBridge,
  selectionEquals,
  selectionFromBridge,
  selectionFromLayer,
  splitPrimaryExtras,
  toggleMultiSelectLayer,
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

  it('multiEntriesFromBridge / toggle / split / bboxes (v0.7 M3)', () => {
    const entries = multiEntriesFromBridge(
      'index.html',
      {
        selector: '#b',
        tag: 'div',
        bbox: { x: 10, y: 10, width: 20, height: 20 },
        multi: [
          { selector: '#a', tag: 'div', bbox: { x: 0, y: 0, width: 10, height: 10 } },
          { selector: '#b', tag: 'div', bbox: { x: 10, y: 10, width: 20, height: 20 } },
        ],
      },
      (sel) => (sel === '#a' ? 'id-a' : 'id-b'),
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]!.selection.layerId).toBe('id-b');
    const { primary, extras } = splitPrimaryExtras(entries);
    expect(primary?.selection.selector).toBe('#b');
    expect(extras).toHaveLength(1);

    const boxes = bboxesFromMultiEntries(entries);
    expect(boxes.primary?.width).toBe(20);
    expect(boxes.extras).toHaveLength(1);

    const toggled = toggleMultiSelectLayer(entries, 'index.html', {
      id: 'id-a',
      selector: '#a',
    });
    expect(toggled).toHaveLength(1);
    expect(toggled[0]!.selection.selector).toBe('#b');

    const added = toggleMultiSelectLayer(toggled, 'index.html', {
      id: 'id-c',
      selector: '#c',
      tag: 'span',
    });
    expect(added).toHaveLength(2);
    expect(added[1]!.selection.selector).toBe('#c');
  });
});
