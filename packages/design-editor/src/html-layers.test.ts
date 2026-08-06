import { describe, expect, it } from 'vitest';
import {
  bridgeTreeToLayers,
  filterLayers,
  findLayerById,
  findLayerBySelector,
  flattenLayers,
  parseHtmlToLayerTree,
  applyZOrderInHtml,
  reorderSiblingByNeosId,
  reorderSiblingInHtml,
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

describe('reorderSiblingInHtml (v0.9 M0)', () => {
  const LIST = `<!DOCTYPE html><html><body>
  <ul data-neos-id="list">
    <li data-neos-id="a">A</li>
    <li data-neos-id="b">B</li>
    <li data-neos-id="c">C</li>
  </ul>
</body></html>`;

  it('moves B before A (same parent)', () => {
    const result = reorderSiblingInHtml(
      LIST,
      { neosId: 'b' },
      { beforeNeosId: 'a' },
    );
    expect(result.ok).toBe(true);
    expect(result.html).toMatch(
      /data-neos-id="b"[\s\S]*data-neos-id="a"[\s\S]*data-neos-id="c"/,
    );
  });

  it('moves A after C (append among siblings)', () => {
    const result = reorderSiblingByNeosId(LIST, 'a', { afterNeosId: 'c' });
    expect(result.ok).toBe(true);
    expect(result.html).toMatch(
      /data-neos-id="b"[\s\S]*data-neos-id="c"[\s\S]*data-neos-id="a"/,
    );
  });

  it('supports toIndex as final sibling index', () => {
    // Move C to index 0
    const result = reorderSiblingInHtml(LIST, { neosId: 'c' }, { toIndex: 0 });
    expect(result.ok).toBe(true);
    expect(result.html).toMatch(
      /data-neos-id="c"[\s\S]*data-neos-id="a"[\s\S]*data-neos-id="b"/,
    );
  });

  it('rejects locked source', () => {
    const locked = LIST.replace(
      'data-neos-id="b"',
      'data-neos-id="b" data-neos-locked="true"',
    );
    const result = reorderSiblingInHtml(
      locked,
      { neosId: 'b' },
      { beforeNeosId: 'a' },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('locked');
    expect(result.html).toBe(locked);
  });

  it('rejects different parent', () => {
    const nested = `<body>
      <div data-neos-id="p1"><span data-neos-id="s1">1</span></div>
      <div data-neos-id="p2"><span data-neos-id="s2">2</span></div>
    </body>`;
    const result = reorderSiblingInHtml(
      nested,
      { neosId: 's1' },
      { beforeNeosId: 's2' },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('different-parent');
  });

  it('no-op when already in place', () => {
    const result = reorderSiblingInHtml(
      LIST,
      { neosId: 'a' },
      { beforeNeosId: 'b' },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-op');
  });

  it('not-found for missing id', () => {
    const result = reorderSiblingInHtml(
      LIST,
      { neosId: 'missing' },
      { beforeNeosId: 'a' },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-found');
  });

  it('works after stampNeosIds when only class selectors exist', () => {
    const raw = '<body><div class="box"><p>one</p><p>two</p></div></body>';
    const stamped = stampNeosIds(raw);
    const layers = parseHtmlToLayerTree(stamped);
    const flat = flattenLayers(layers);
    const paragraphs = flat.filter((n) => n.tag === 'p');
    expect(paragraphs.length).toBe(2);
    const [p1, p2] = paragraphs;
    const result = reorderSiblingInHtml(
      stamped,
      { neosId: p2.id },
      { beforeNeosId: p1.id },
    );
    expect(result.ok).toBe(true);
    // first <p> in document should now be former p2 text "two"
    const body = result.html.replace(/\s+/g, ' ');
    const firstP = /<p[^>]*>[^<]*/.exec(body)?.[0] ?? '';
    expect(firstP).toMatch(/two/);
  });
});

describe('applyZOrderInHtml (v0.9 M1)', () => {
  const STACK = `<body>
    <div data-neos-id="a">A</div>
    <div data-neos-id="b">B</div>
    <div data-neos-id="c">C</div>
  </body>`;

  it('brings forward and sends to back', () => {
    const fwd = applyZOrderInHtml(STACK, { neosId: 'a' }, 'forward');
    expect(fwd.ok).toBe(true);
    expect(fwd.html).toMatch(
      /data-neos-id="b"[\s\S]*data-neos-id="a"[\s\S]*data-neos-id="c"/,
    );
    const back = applyZOrderInHtml(STACK, { neosId: 'c' }, 'back');
    expect(back.ok).toBe(true);
    expect(back.html).toMatch(
      /data-neos-id="c"[\s\S]*data-neos-id="a"[\s\S]*data-neos-id="b"/,
    );
  });

  it('no-op at edge and locked', () => {
    expect(applyZOrderInHtml(STACK, { neosId: 'a' }, 'back').reason).toBe('no-op');
    expect(applyZOrderInHtml(STACK, { neosId: 'c' }, 'front').reason).toBe('no-op');
    const locked = STACK.replace(
      'data-neos-id="b"',
      'data-neos-id="b" data-neos-locked="true"',
    );
    expect(applyZOrderInHtml(locked, { neosId: 'b' }, 'forward').reason).toBe(
      'locked',
    );
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

  it('uses aria-label / data-neos-name in display names', () => {
    const tree = parseHtmlToLayerTree(
      '<body><button aria-label="Save draft">S</button><div data-neos-name="Hero">H</div></body>',
    );
    const flat = flattenLayers(tree);
    expect(flat.some((n) => n.name.includes('Save draft'))).toBe(true);
    expect(flat.some((n) => n.name.includes('Hero'))).toBe(true);
  });

  it('findLayerBySelector miss and invalid toggle ids no-op', () => {
    const tree = parseHtmlToLayerTree(SAMPLE);
    expect(findLayerBySelector(tree, 'does-not-exist')).toBeNull();
    expect(toggleVisibilityByNeosId('<div/>', '', false)).toBe('<div/>');
    expect(toggleVisibilityByNeosId('<div/>', 'bad id!', false)).toBe('<div/>');
    expect(toggleVisibilityByNeosId('<div data-neos-id="e1"/>', 'e99', false)).toBe(
      '<div data-neos-id="e1"/>',
    );
    expect(toggleLockByNeosId('<div/>', 'x y', true)).toBe('<div/>');
  });

  it('toggleVisibilityInHtml data-neos-id selector path returns html', () => {
    const html = '<div data-neos-id="e1">x</div>';
    // selector form is recognized but rewrite is best-effort stub → returns original
    expect(
      toggleVisibilityInHtml(html, '[data-neos-id="e1"]', false),
    ).toBe(html);
    expect(
      toggleVisibilityInHtml(html, 'something data-neos-id else', false),
    ).toBe(html);
  });

  it('builds nth-of-type selectors for sibling tags without id', () => {
    const tree = parseHtmlToLayerTree(
      '<body><p>one</p><p>two</p></body>',
    );
    const flat = flattenLayers(tree);
    const ps = flat.filter((n) => n.tag === 'p');
    expect(ps.length).toBe(2);
    expect(ps.some((n) => n.selector.includes('nth-of-type'))).toBe(true);
  });
});
