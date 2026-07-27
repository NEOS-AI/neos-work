import { describe, expect, it } from 'vitest';
import {
  bridgeTreeToLayers,
  filterLayers,
  findLayerById,
  findLayerBySelector,
  flattenLayers,
  parseHtmlToLayerTree,
  stampNeosIds,
  toggleLockByNeosId,
  toggleVisibilityByNeosId,
  toggleVisibilityInHtml,
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

describe('html-layers extra', () => {
  it('returns empty for blank html and skips script/style tags', () => {
    expect(parseHtmlToLayerTree('')).toEqual([]);
    expect(parseHtmlToLayerTree('   ')).toEqual([]);
    const tree = parseHtmlToLayerTree(
      '<body><script>x</script><style>y</style><p>ok</p></body>',
    );
    const flat = flattenLayers(tree);
    expect(flat.some((n) => n.tag === 'script')).toBe(false);
    expect(flat.some((n) => n.tag === 'style')).toBe(false);
    expect(flat.some((n) => n.tag === 'p')).toBe(true);
  });

  it('bridgeTreeToLayers maps bridge nodes; findLayerById works', () => {
    const mapped = bridgeTreeToLayers([
      {
        id: 'e1',
        tag: 'div',
        name: 'div',
        selector: 'div',
        depth: 0,
        visible: true,
        locked: false,
        children: [
          {
            id: 'e2',
            tag: 'span',
            name: 'span',
            selector: 'span',
            depth: 1,
            visible: true,
            locked: false,
            children: [],
          },
        ],
      },
    ]);
    expect(mapped[0]!.children[0]!.id).toBe('e2');
    expect(findLayerById(mapped, 'e2')?.tag).toBe('span');
    expect(findLayerById(mapped, 'missing')).toBeNull();
  });

  it('toggleVisibilityInHtml rewrites #id selectors and no-ops weak selectors', () => {
    const html = '<div id="hero">Hi</div>';
    const hidden = toggleVisibilityInHtml(html, '#hero', false);
    expect(hidden).toMatch(/hidden|data-neos-hidden/i);
    const shown = toggleVisibilityInHtml(hidden, '#hero', true);
    expect(shown).not.toMatch(/data-neos-hidden="true"/);
    expect(toggleVisibilityInHtml(html, '', false)).toBe(html);
    expect(toggleVisibilityInHtml(html, 'div', false)).toBe(html);
  });

  it('filterLayers with empty query returns original tree', () => {
    const tree = parseHtmlToLayerTree(SAMPLE);
    expect(filterLayers(tree, '  ')).toEqual(tree);
  });

  it('respects hidden and locked attributes in parse', () => {
    const tree = parseHtmlToLayerTree(
      '<body><div id="a" hidden>x</div><div id="b" data-neos-locked="true">y</div></body>',
    );
    const flat = flattenLayers(tree);
    expect(flat.find((n) => n.id && n.selector.includes('#a'))?.visible === false
      || flat.some((n) => n.name.includes('#a') && !n.visible)).toBe(true);
    expect(flat.some((n) => n.locked)).toBe(true);
  });
});
