/**
 * HTML → LayerNode[] parse fallback (dirty / no iframe snapshot yet).
 * Prefer live DOM snapshot from bridge when available.
 */

import type { LayerNode } from '@neos-work/shared';
import type { BridgeDomNode } from './bridge-types.js';

const SKIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'link',
  'meta',
  'template',
]);

function displayName(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const bits: string[] = [tag];
  if (el.id) bits.push(`#${el.id.slice(0, 40)}`);
  if (el.classList?.length) {
    const cls = Array.from(el.classList).slice(0, 2).join('.');
    if (cls) bits.push(`.${cls.slice(0, 48)}`);
  }
  const label =
    el.getAttribute('aria-label') || el.getAttribute('data-neos-name') || '';
  if (label) {
    bits.push(`"${label.slice(0, 24)}"`);
  } else {
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
    if (text && text.length < 32 && el.children.length === 0) {
      bits.push(`"${text.slice(0, 24)}"`);
    }
  }
  return bits.join(' ');
}

function cssPath(el: Element): string {
  if (el.id && /^[A-Za-z][\w\-:.]*$/.test(el.id)) return `#${el.id}`;
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < 12) {
    const tag = cur.tagName.toLowerCase();
    if (tag === 'html') break;
    const parentEl: Element | null = cur.parentElement;
    if (parentEl) {
      const siblings = Array.from(parentEl.children).filter(
        (c: Element) => c.tagName.toLowerCase() === tag,
      );
      const idx = siblings.indexOf(cur) + 1;
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
    } else {
      parts.unshift(tag);
    }
    if (cur.id && /^[A-Za-z][\w\-:.]*$/.test(cur.id)) {
      parts[0] = `#${cur.id}`;
      break;
    }
    cur = parentEl;
    depth++;
  }
  return parts.join(' > ');
}

function isVisible(el: Element): boolean {
  if (el.hasAttribute('hidden')) return false;
  if (el.getAttribute('data-neos-hidden') === 'true') return false;
  return true;
}

function isLocked(el: Element): boolean {
  const v = el.getAttribute('data-neos-locked');
  return v === 'true' || v === '';
}

let idCounter = 0;

function walk(el: Element, depth: number): LayerNode | null {
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return null;

  let id = el.getAttribute('data-neos-id');
  if (!id) {
    idCounter += 1;
    // Match stampNeosIds prefix so visibility/lock rewrites hit the same ids
    id = `e${idCounter}`;
  }

  const children: LayerNode[] = [];
  for (const child of Array.from(el.children)) {
    const n = walk(child, depth + 1);
    if (n) children.push(n);
  }

  return {
    id,
    tag,
    name: displayName(el),
    selector: cssPath(el),
    depth,
    visible: isVisible(el),
    locked: isLocked(el),
    children,
  };
}

/** Convert bridge tree to LayerNode[] (identity mapping). */
export function bridgeTreeToLayers(tree: BridgeDomNode[]): LayerNode[] {
  const map = (n: BridgeDomNode): LayerNode => ({
    id: n.id,
    tag: n.tag,
    name: n.name,
    selector: n.selector,
    depth: n.depth,
    visible: n.visible,
    locked: n.locked,
    children: (n.children ?? []).map(map),
  });
  return tree.map(map);
}

/**
 * Parse HTML string into LayerNode tree (body-rooted when present).
 * Uses DOMParser (jsdom in tests / browser in app).
 */
export function parseHtmlToLayerTree(html: string): LayerNode[] {
  idCounter = 0;
  if (typeof html !== 'string' || !html.trim()) return [];
  if (typeof DOMParser === 'undefined') return [];
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = doc.body ?? doc.documentElement;
    if (!root) return [];
    // If body only has text, still show body
    const node = walk(root, 0);
    return node ? [node] : [];
  } catch {
    return [];
  }
}

/** Flatten tree for search / find. */
export function flattenLayers(nodes: LayerNode[]): LayerNode[] {
  const out: LayerNode[] = [];
  const visit = (list: LayerNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.children?.length) visit(n.children);
    }
  };
  visit(nodes);
  return out;
}

export function findLayerById(nodes: LayerNode[], id: string): LayerNode | null {
  for (const n of flattenLayers(nodes)) {
    if (n.id === id) return n;
  }
  return null;
}

export function findLayerBySelector(
  nodes: LayerNode[],
  selector: string,
): LayerNode | null {
  for (const n of flattenLayers(nodes)) {
    if (n.selector === selector) return n;
  }
  return null;
}

export function filterLayers(
  nodes: LayerNode[],
  query: string,
): LayerNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  const match = (n: LayerNode): LayerNode | null => {
    const selfHit =
      n.name.toLowerCase().includes(q)
      || n.tag.toLowerCase().includes(q)
      || n.selector.toLowerCase().includes(q);
    const kids = n.children
      .map(match)
      .filter((c): c is LayerNode => c != null);
    if (selfHit || kids.length > 0) {
      return { ...n, children: selfHit ? n.children : kids };
    }
    return null;
  };

  return nodes.map(match).filter((n): n is LayerNode => n != null);
}

/**
 * Best-effort toggle `hidden` / data-neos-hidden on first matching open tag in HTML.
 * Returns original if no safe match.
 */
export function toggleVisibilityInHtml(
  html: string,
  selector: string,
  visible: boolean,
): string {
  if (!html || !selector) return html;
  // Prefer id selector rewrite
  const idMatch = /^#([A-Za-z][\w\-:.]*)$/.exec(selector.trim());
  if (idMatch) {
    const id = idMatch[1];
    const re = new RegExp(
      `(<([A-Za-z][\\w-]*)\\b[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*)(/?)>`,
      'i',
    );
    return html.replace(re, (full, open: string, _tag: string, selfClose: string) => {
      return applyHiddenAttr(open, selfClose, visible);
    });
  }
  // data-neos-id
  const dataId = /\[data-neos-id=["']([^"']+)["']\]/.exec(selector)
    ?? null;
  // try walk parse + serialize is heavy; simple: data-neos-id attribute in HTML
  if (!dataId) {
    // Fallback: if selector is a bare tag with nth — skip rewrite
    const neosIdFromTree = selector.includes('data-neos-id');
    if (!neosIdFromTree) {
      // Attempt tag-only first occurrence (weak)
      return html;
    }
  }
  return html;
}

/**
 * Toggle visibility using data-neos-id stamped into HTML when present.
 */
export function toggleVisibilityByNeosId(
  html: string,
  neosId: string,
  visible: boolean,
): string {
  if (!html || !neosId || /[^\w-]/.test(neosId)) return html;
  const re = new RegExp(
    `(<([A-Za-z][\\w-]*)\\b[^>]*\\bdata-neos-id=["']${escapeRegExp(neosId)}["'][^>]*)(/?)>`,
    'i',
  );
  if (!re.test(html)) {
    // try id attribute matching layer id pattern when bridge stamped into srcDoc only
    return html;
  }
  return html.replace(re, (full, open: string, _tag: string, selfClose: string) => {
    return applyHiddenAttr(open, selfClose, visible);
  });
}

/**
 * Toggle lock via data-neos-locked on data-neos-id element.
 */
export function toggleLockByNeosId(
  html: string,
  neosId: string,
  locked: boolean,
): string {
  if (!html || !neosId || /[^\w-]/.test(neosId)) return html;
  const re = new RegExp(
    `(<([A-Za-z][\\w-]*)\\b[^>]*\\bdata-neos-id=["']${escapeRegExp(neosId)}["'][^>]*)(/?)>`,
    'i',
  );
  if (!re.test(html)) return html;
  return html.replace(re, (full, open: string, _tag: string, selfClose: string) => {
    let o = open;
    if (locked) {
      if (!/\bdata-neos-locked\b/i.test(o)) {
        o = `${o} data-neos-locked="true"`;
      }
    } else {
      o = o
        .replace(/\s*data-neos-locked=(["'])true\1/gi, '')
        .replace(/\s*data-neos-locked=(["'])\1/gi, '')
        .replace(/\s*data-neos-locked\b/gi, '');
    }
    return `${o}${selfClose}>`;
  });
}

function applyHiddenAttr(open: string, selfClose: string, visible: boolean): string {
  let o = open;
  if (visible) {
    o = o
      .replace(/\s+hidden\b/gi, '')
      .replace(/\s*data-neos-hidden=(["'])true\1/gi, '')
      .replace(/\s*data-neos-hidden\b/gi, '');
  } else {
    if (!/\bhidden\b/i.test(o)) o = `${o} hidden`;
    if (!/\bdata-neos-hidden\b/i.test(o)) o = `${o} data-neos-hidden="true"`;
  }
  return `${o}${selfClose}>`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Source identity for sibling reorder (prefer `data-neos-id`). */
export type ReorderSiblingSource = {
  neosId?: string | null;
  selector?: string | null;
};

/**
 * Target position among the same parent’s element children (Q24: same-parent only).
 * Prefer before/after sibling identity; `toIndex` is the desired final 0-based index.
 */
export type ReorderSiblingTarget = {
  /** Desired final index among parent.element children after the move. */
  toIndex?: number;
  beforeNeosId?: string | null;
  beforeSelector?: string | null;
  afterNeosId?: string | null;
  afterSelector?: string | null;
};

export type ReorderSiblingReason =
  | 'invalid-input'
  | 'not-found'
  | 'no-parent'
  | 'locked'
  | 'target-not-found'
  | 'different-parent'
  | 'no-op'
  | 'no-domparser';

export type ReorderSiblingResult = {
  html: string;
  ok: boolean;
  reason?: ReorderSiblingReason;
};

function findElementByIdentity(
  doc: Document,
  neosId?: string | null,
  selector?: string | null,
): Element | null {
  const id = typeof neosId === 'string' ? neosId.trim() : '';
  if (id && /^[\w-]+$/.test(id)) {
    try {
      const byNeos = doc.querySelector(`[data-neos-id="${id}"]`);
      if (byNeos) return byNeos;
    } catch {
      // ignore bad selector construction
    }
  }
  const sel = typeof selector === 'string' ? selector.trim() : '';
  if (sel) {
    try {
      return doc.querySelector(sel);
    } catch {
      return null;
    }
  }
  return null;
}

function serializeHtmlDocument(html: string, doc: Document): string {
  const hasDoctype = /^\s*<!DOCTYPE/i.test(html);
  const serialized = doc.documentElement?.outerHTML ?? html;
  return hasDoctype ? `<!DOCTYPE html>${serialized}` : serialized;
}

type SiblingPlacementContext = {
  doc: Document;
  el: Element;
  parent: Element;
  fromIndex: number;
  childrenBefore: Element[];
};

/**
 * Shared DOM sibling-order mutation path for reorder + z-order.
 * Placement callback may return a reason to abort, or void after moving `el`.
 */
function mutateSiblingOrder(
  html: string,
  source: ReorderSiblingSource,
  place: (ctx: SiblingPlacementContext) => ReorderSiblingReason | void,
): ReorderSiblingResult {
  if (typeof DOMParser === 'undefined') {
    return { html, ok: false, reason: 'no-domparser' };
  }
  if (typeof html !== 'string' || !html.trim()) {
    return { html, ok: false, reason: 'invalid-input' };
  }
  if (!source?.neosId && !source?.selector) {
    return { html, ok: false, reason: 'invalid-input' };
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = findElementByIdentity(doc, source.neosId, source.selector);
    if (!el) return { html, ok: false, reason: 'not-found' };
    if (isLocked(el)) return { html, ok: false, reason: 'locked' };

    const parent = el.parentElement;
    if (!parent) return { html, ok: false, reason: 'no-parent' };

    const childrenBefore = Array.from(parent.children);
    const fromIndex = childrenBefore.indexOf(el);
    if (fromIndex < 0) return { html, ok: false, reason: 'not-found' };

    const abort = place({ doc, el, parent, fromIndex, childrenBefore });
    if (abort) return { html, ok: false, reason: abort };

    // Verify order actually changed
    const childrenAfter = Array.from(parent.children);
    if (childrenAfter.indexOf(el) === fromIndex) {
      return { html, ok: false, reason: 'no-op' };
    }

    return { html: serializeHtmlDocument(html, doc), ok: true };
  } catch {
    return { html, ok: false, reason: 'invalid-input' };
  }
}

/**
 * Reorder a sibling among the same parent in HTML (v0.9 M0).
 * Disk/file SSOT stays the buffer string — this only rewrites DOM sibling order.
 *
 * - Same-parent only (different parent → `different-parent`)
 * - Locked source (`data-neos-locked`) → `locked`
 * - Multi-select hosts should pass the **primary** only
 */
export function reorderSiblingInHtml(
  html: string,
  source: ReorderSiblingSource,
  target: ReorderSiblingTarget,
): ReorderSiblingResult {
  const hasTarget =
    typeof target?.toIndex === 'number'
    || Boolean(target?.beforeNeosId || target?.beforeSelector)
    || Boolean(target?.afterNeosId || target?.afterSelector);
  if (!hasTarget) {
    return { html, ok: false, reason: 'invalid-input' };
  }

  return mutateSiblingOrder(html, source, ({ doc, el, parent, fromIndex, childrenBefore }) => {
    let refNode: ChildNode | null | undefined;
    // undefined = not resolved; null = append at end

    if (target.beforeNeosId || target.beforeSelector) {
      const beforeEl = findElementByIdentity(
        doc,
        target.beforeNeosId,
        target.beforeSelector,
      );
      if (!beforeEl) return 'target-not-found';
      if (beforeEl.parentElement !== parent) return 'different-parent';
      if (beforeEl === el) return 'no-op';
      // Already immediately before target
      if (el.nextElementSibling === beforeEl) return 'no-op';
      refNode = beforeEl;
    } else if (target.afterNeosId || target.afterSelector) {
      const afterEl = findElementByIdentity(
        doc,
        target.afterNeosId,
        target.afterSelector,
      );
      if (!afterEl) return 'target-not-found';
      if (afterEl.parentElement !== parent) return 'different-parent';
      if (afterEl === el) return 'no-op';
      // Already immediately after target
      if (afterEl.nextElementSibling === el) return 'no-op';
      refNode = afterEl.nextElementSibling;
    } else if (typeof target.toIndex === 'number' && Number.isFinite(target.toIndex)) {
      const desired = Math.floor(target.toIndex);
      if (desired === fromIndex) return 'no-op';
      // Remove mentally: remaining siblings; final index among children after re-insert
      const remaining = childrenBefore.filter((c) => c !== el);
      const insertAt = Math.max(0, Math.min(desired, remaining.length));
      refNode = remaining[insertAt] ?? null;
      // If we would insert at the same visual position, no-op
      if (refNode === el.nextElementSibling || (refNode == null && fromIndex === childrenBefore.length - 1)) {
        // fromIndex last and append → no-op already handled by desired === fromIndex
        // if ref is next sibling, moving before next = no-op
        if (refNode === el.nextElementSibling) {
          return 'no-op';
        }
      }
    } else {
      return 'invalid-input';
    }

    parent.insertBefore(el, refNode ?? null);
  });
}

/**
 * Convenience: move by `data-neos-id` before/after another neos id (same parent).
 */
export function reorderSiblingByNeosId(
  html: string,
  sourceNeosId: string,
  target: { beforeNeosId?: string; afterNeosId?: string; toIndex?: number },
): ReorderSiblingResult {
  return reorderSiblingInHtml(
    html,
    { neosId: sourceNeosId },
    {
      beforeNeosId: target.beforeNeosId,
      afterNeosId: target.afterNeosId,
      toIndex: target.toIndex,
    },
  );
}

/** Z-order among same-parent siblings (v0.9 M1). */
export type ZOrderOp = 'forward' | 'backward' | 'front' | 'back';

/**
 * Nudge DOM sibling order (paint order) under the same parent.
 * - forward: swap with next element sibling
 * - backward: swap with previous
 * - front: last child
 * - back: first child
 */
export function applyZOrderInHtml(
  html: string,
  source: ReorderSiblingSource,
  op: ZOrderOp,
): ReorderSiblingResult {
  return mutateSiblingOrder(html, source, ({ el, parent, fromIndex, childrenBefore }) => {
    if (op === 'forward') {
      const next = el.nextElementSibling;
      if (!next) return 'no-op';
      parent.insertBefore(el, next.nextElementSibling);
    } else if (op === 'backward') {
      const prev = el.previousElementSibling;
      if (!prev) return 'no-op';
      parent.insertBefore(el, prev);
    } else if (op === 'front') {
      if (fromIndex === childrenBefore.length - 1) return 'no-op';
      parent.appendChild(el);
    } else if (op === 'back') {
      if (fromIndex === 0) return 'no-op';
      parent.insertBefore(el, parent.firstElementChild);
    } else {
      return 'invalid-input';
    }
  });
}

/**
 * Stamp stable data-neos-id onto elements in HTML for later buffer rewrites.
 * Best-effort via DOMParser serialize.
 */
export function stampNeosIds(html: string): string {
  if (typeof DOMParser === 'undefined' || !html.trim()) return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let i = 0;
    const walkEl = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return;
      if (!el.getAttribute('data-neos-id')) {
        i += 1;
        el.setAttribute('data-neos-id', `e${i}`);
      }
      for (const c of Array.from(el.children)) walkEl(c);
    };
    if (doc.body) walkEl(doc.body);
    // Prefer full document serialize
    const hasDoctype = /^\s*<!DOCTYPE/i.test(html);
    const serialized = doc.documentElement?.outerHTML ?? html;
    return hasDoctype ? `<!DOCTYPE html>${serialized}` : serialized;
  } catch {
    return html;
  }
}
