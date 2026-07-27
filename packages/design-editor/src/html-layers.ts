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
