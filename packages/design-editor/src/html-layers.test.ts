import { describe, expect, it } from 'vitest';
import {
  filterLayers,
  findLayerBySelector,
  flattenLayers,
  parseHtmlToLayerTree,
  stampNeosIds,
  toggleLockByNeosId,
  toggleVisibilityByNeosId,
} from './html-layers.js';
import { injectBridgeIntoHtml, buildBridgeInjectScript } from './bridge-inject.js';
import {
  editContextFromSelection,
  selectionFromLayer,
  selectionEquals,
} from './selection-state.js';

const SAMPLE = `<!DOCTYPE html><html><body>
  <header id="top"><h1 class="title">Hello</h1></header>
  <main><section data-neos-id="e9"><p>Para</p></section></main>
</body></html>`;

describe('parseHtmlToLayerTree', () => {
  it('builds a body-rooted hierarchy with selectors', () => {
    const tree = parseHtmlToLayerTree(SAMPLE);
    expect(tree.length).toBe(1);
    expect(tree[0].tag).toBe('body');
    const flat = flattenLayers(tree);
    expect(flat.some((n) => n.tag === 'h1')).toBe(true);
    expect(flat.some((n) => n.selector.includes('#top') || n.name.includes('#top'))).toBe(true);
  });

  it('filters by query', () => {
    const tree = parseHtmlToLayerTree(SAMPLE);
    const filtered = filterLayers(tree, 'h1');
    const flat = flattenLayers(filtered);
    expect(flat.some((n) => n.tag === 'h1')).toBe(true);
  });

  it('finds by selector', () => {
    const tree = parseHtmlToLayerTree(SAMPLE);
    const flat = flattenLayers(tree);
    const header = flat.find((n) => n.tag === 'header');
    expect(header).toBeTruthy();
    expect(findLayerBySelector(tree, header!.selector)?.id).toBe(header!.id);
  });
});

describe('stamp + visibility/lock', () => {
  it('stamps data-neos-id and toggles hidden', () => {
    const stamped = stampNeosIds('<body><div class="x">a</div></body>');
    expect(stamped).toContain('data-neos-id');
    const idMatch = /data-neos-id="([^"]+)"/.exec(stamped);
    expect(idMatch).toBeTruthy();
    const id = idMatch![1];
    const hidden = toggleVisibilityByNeosId(stamped, id, false);
    expect(hidden).toMatch(/hidden/i);
    const shown = toggleVisibilityByNeosId(hidden, id, true);
    expect(shown).not.toMatch(/data-neos-hidden="true"/);
  });

  it('parse layer ids align with stamp ids so visibility rewrites work', () => {
    const raw = '<body><div class="box"><span>hi</span></div></body>';
    const stamped = stampNeosIds(raw);
    const layers = parseHtmlToLayerTree(stamped);
    const flat = flattenLayers(layers);
    const span = flat.find((n) => n.tag === 'span');
    expect(span?.id).toMatch(/^e\d+$/);
    const hidden = toggleVisibilityByNeosId(stamped, span!.id, false);
    expect(hidden).not.toBe(stamped);
    expect(hidden).toMatch(/hidden/i);
  });

  it('toggles lock attribute', () => {
    const html = '<div data-neos-id="e1">x</div>';
    const locked = toggleLockByNeosId(html, 'e1', true);
    expect(locked).toContain('data-neos-locked');
    const unlocked = toggleLockByNeosId(locked, 'e1', false);
    expect(unlocked).not.toContain('data-neos-locked');
  });
});

describe('bridge inject', () => {
  it('injects once before body close', () => {
    const a = injectBridgeIntoHtml('<html><body><p>x</p></body></html>');
    expect(a).toContain('data-neos-bridge="1"');
    expect(a).toContain('neos.ready');
    const b = injectBridgeIntoHtml(a);
    expect(b).toBe(a);
    expect(buildBridgeInjectScript().length).toBeGreaterThan(100);
  });
});

describe('selection helpers', () => {
  it('builds editContext from layer selection', () => {
    const sel = selectionFromLayer('index.html', {
      id: 'n1',
      selector: 'main > section',
    });
    expect(selectionEquals(sel, sel)).toBe(true);
    const ctx = editContextFromSelection(sel, { snippet: '<section/>' });
    expect(ctx.mode).toBe('replace-selection');
    expect(ctx.selection).toEqual({ selector: 'main > section' });
    expect(ctx.snippet).toContain('section');
  });
});
