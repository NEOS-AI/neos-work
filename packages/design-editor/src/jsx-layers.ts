/**
 * Best-effort JSX/TSX → LayerNode[] (v0.6 M1).
 * Not a full AST — extracts tag hierarchy from the primary return JSX.
 * Incomplete parse sets incomplete=true so UI can show a badge.
 */

import type { LayerNode } from '@neos-work/shared';

export function isJsxPath(path: string | null | undefined): boolean {
  if (!path || typeof path !== 'string') return false;
  const p = path.toLowerCase();
  return p.endsWith('.jsx') || p.endsWith('.tsx');
}

export type JsxLayerParseResult = {
  layers: LayerNode[];
  incomplete: boolean;
  /** Human-readable note for empty / partial trees. */
  note?: string;
};

type TagOpen = {
  name: string;
  attrs: string;
  selfClosing: boolean;
  start: number;
  end: number;
};

function stripComments(src: string): string {
  // Block comments then line comments (naive, good enough for structure)
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Pull the most likely top-level JSX expression after `return`. */
export function extractJsxReturnSnippet(source: string): string | null {
  if (typeof source !== 'string' || !source.trim()) return null;
  const cleaned = stripComments(source);
  // return ( ... )  or return <
  const re = /\breturn\s*(?:\(([\s\S]*?)\)\s*;?|([\s\S]*?))\s*(?:;|\n\s*\})/g;
  let best: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const body = (m[1] ?? m[2] ?? '').trim();
    if (body.includes('<') && body.length > (best?.length ?? 0)) {
      best = body;
    }
  }
  if (best) return best;
  // Fallback: first fragment / root tag in file
  const frag = cleaned.match(/<>([\s\S]*?)<\/>/);
  if (frag) return `<>${frag[1]}</>`;
  const tag = cleaned.match(/<[A-Za-z][\w.]*[\s\S]{0,8000}/);
  return tag ? tag[0] : null;
}

/**
 * Convert common JSX sugar to HTML-ish markup for structure-only parsing.
 * Expressions `{...}` become empty or data-jsx-expr placeholders.
 */
export function jsxSnippetToPseudoHtml(jsx: string): string {
  let s = jsx.trim();
  // Fragments
  s = s.replace(/<>/g, '<div data-jsx-fragment="true">').replace(/<\/>/g, '</div>');
  // Self-closing custom components already ok
  // className → class
  s = s.replace(/\bclassName=/g, 'class=');
  s = s.replace(/\bhtmlFor=/g, 'for=');
  // Remove TypeScript casts / as const noise in attrs (best-effort)
  // Collapse JSX expressions in attribute values: foo={...} → data-expr-foo=""
  s = s.replace(
    /(\s)([A-Za-z_:][\w:.-]*)=\{[\s\S]*?\}/g,
    (_full, sp: string, name: string) => {
      if (name === 'class' || name === 'id' || name === 'style') {
        return `${sp}${name}=""`;
      }
      return `${sp}data-jsx-${name.toLowerCase()}="expr"`;
    },
  );
  // Children expressions {foo} → omit (structure only)
  s = s.replace(/\{[^{}]{0,200}\}/g, '');
  // Component names PascalCase stay as custom tags — DOMParser lowercases in HTML mode.
  // Prefix components so they survive as unknown elements: MyComp → jsx-mycomp via rewrite
  s = s.replace(/<\/([A-Z][\w.]*)>/g, (_f, n: string) => `</jsx-${n.replace(/\./g, '-').toLowerCase()}>`);
  s = s.replace(/<([A-Z][\w.]*)(\s|>|\/>)/g, (_f, n: string, end: string) => {
    return `<jsx-${n.replace(/\./g, '-').toLowerCase()}${end}`;
  });
  return s;
}

let idCounter = 0;

function walkElement(el: Element, depth: number): LayerNode | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style') return null;

  idCounter += 1;
  const id = el.getAttribute('data-neos-id') || `j${idCounter}`;
  const isFragment = el.getAttribute('data-jsx-fragment') === 'true';
  const displayTag = isFragment
    ? 'Fragment'
    : tag.startsWith('jsx-')
      ? tag.slice(4)
      : tag;

  const bits = [displayTag];
  if (el.id) bits.push(`#${el.id.slice(0, 40)}`);
  const cls = el.getAttribute('class');
  if (cls) bits.push(`.${cls.split(/\s+/).slice(0, 2).join('.').slice(0, 48)}`);

  const children: LayerNode[] = [];
  for (const child of Array.from(el.children)) {
    const n = walkElement(child, depth + 1);
    if (n) children.push(n);
  }

  // Flatten single wrapper fragment at root handled by caller
  return {
    id,
    tag: displayTag,
    name: bits.join(' '),
    selector: isFragment
      ? `[data-jsx-fragment]/*`
      : tag.startsWith('jsx-')
        ? displayTag
        : el.id
          ? `#${el.id}`
          : displayTag,
    depth,
    visible: !el.hasAttribute('hidden'),
    locked: false,
    children,
  };
}

/**
 * Parse JSX/TSX source into a Layers tree. Uses DOMParser on pseudo-HTML.
 */
export function parseJsxToLayerTree(source: string): JsxLayerParseResult {
  idCounter = 0;
  if (typeof source !== 'string' || !source.trim()) {
    return { layers: [], incomplete: true, note: 'Empty source' };
  }
  if (typeof DOMParser === 'undefined') {
    return { layers: [], incomplete: true, note: 'DOMParser unavailable' };
  }

  const snippet = extractJsxReturnSnippet(source);
  if (!snippet) {
    return {
      layers: [],
      incomplete: true,
      note: 'No return JSX found (best-effort)',
    };
  }

  let incomplete = false;
  // Unbalanced angle brackets → incomplete
  const opens = (snippet.match(/</g) ?? []).length;
  const closes = (snippet.match(/>/g) ?? []).length;
  if (opens !== closes) incomplete = true;

  const pseudo = jsxSnippetToPseudoHtml(snippet);
  try {
    const doc = new DOMParser().parseFromString(
      `<div data-jsx-root="true">${pseudo}</div>`,
      'text/html',
    );
    const root = doc.body?.querySelector('[data-jsx-root="true"]') ?? doc.body;
    if (!root) {
      return { layers: [], incomplete: true, note: 'Parse root missing' };
    }

    const layers: LayerNode[] = [];
    for (const child of Array.from(root.children)) {
      const n = walkElement(child, 0);
      if (n) layers.push(n);
    }

    // If DOMParser dropped everything (invalid), mark incomplete
    if (layers.length === 0) {
      return {
        layers: [],
        incomplete: true,
        note: 'Could not recover tag tree from JSX',
      };
    }

    // Nested expressions / spread that we stripped → soft incomplete if many exprs removed
    if (/\{[\s\S]{20,}\}/.test(snippet)) incomplete = true;

    return { layers, incomplete };
  } catch {
    return { layers: [], incomplete: true, note: 'JSX parse error' };
  }
}
