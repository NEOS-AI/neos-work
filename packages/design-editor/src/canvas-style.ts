/**
 * Canvas overlay helpers (v0.6 M2) — apply drag deltas as inline styles in HTML SSOT.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Feature flag: NEOS_CANVAS_OVERLAY=1 or VITE_NEOS_CANVAS_OVERLAY=1, or explicit prop. */
export function isCanvasOverlayEnabled(explicit?: boolean | null): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  try {
    const g = globalThis as {
      NEOS_CANVAS_OVERLAY?: string;
      process?: { env?: Record<string, string | undefined> };
    };
    if (g.NEOS_CANVAS_OVERLAY === '1' || g.NEOS_CANVAS_OVERLAY === 'true') return true;
    const pe = g.process?.env;
    if (pe?.NEOS_CANVAS_OVERLAY === '1' || pe?.NEOS_CANVAS_OVERLAY === 'true') return true;
  } catch {
    // ignore
  }
  try {
    // Vite injects import.meta.env
    const meta = import.meta as { env?: Record<string, string | undefined> };
    const e = meta.env;
    if (
      e?.NEOS_CANVAS_OVERLAY === '1'
      || e?.NEOS_CANVAS_OVERLAY === 'true'
      || e?.VITE_NEOS_CANVAS_OVERLAY === '1'
      || e?.VITE_NEOS_CANVAS_OVERLAY === 'true'
    ) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function parseStyleAttr(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function serializeStyle(map: Record<string, string>): string {
  return Object.entries(map)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

function parsePx(v: string | undefined): number {
  if (!v) return 0;
  const m = /^(-?[\d.]+)px$/i.exec(v.trim());
  return m ? Number(m[1]) : 0;
}

/**
 * Merge position/transform offset into an open-tag attribute string.
 * Ensures position:relative (or keeps absolute/fixed) and accumulates left/top in px.
 */
export function mergePositionDeltaIntoOpenTag(open: string, dx: number, dy: number): string {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return open;
  if (dx === 0 && dy === 0) return open;

  const styleMatch = /\bstyle=(["'])([\s\S]*?)\1/i.exec(open);
  const map = styleMatch ? parseStyleAttr(styleMatch[2] ?? '') : {};
  const pos = (map.position ?? '').toLowerCase();
  if (!pos || pos === 'static') {
    map.position = 'relative';
  }
  const left = parsePx(map.left) + dx;
  const top = parsePx(map.top) + dy;
  map.left = `${Math.round(left)}px`;
  map.top = `${Math.round(top)}px`;
  const styleStr = serializeStyle(map);

  if (styleMatch) {
    return open.replace(styleMatch[0], `style="${styleStr}"`);
  }
  return `${open} style="${styleStr}"`;
}

/**
 * Apply drag delta to the first element matching data-neos-id or #id in HTML source.
 * Returns original html if no match or zero delta.
 */
export function applyPositionDeltaToHtml(
  html: string,
  opts: {
    neosId?: string | null;
    /** CSS id without # */
    elementId?: string | null;
    dx: number;
    dy: number;
  },
): string {
  if (!html || (opts.dx === 0 && opts.dy === 0)) return html;
  const neosId = opts.neosId && !/[^\w-]/.test(opts.neosId) ? opts.neosId : '';
  const elementId =
    opts.elementId && /^[A-Za-z][\w\-:.]*$/.test(opts.elementId) ? opts.elementId : '';

  let re: RegExp | null = null;
  if (neosId) {
    re = new RegExp(
      `(<([A-Za-z][\\w-]*)\\b[^>]*\\bdata-neos-id=["']${escapeRegExp(neosId)}["'][^>]*)(/?)>`,
      'i',
    );
  } else if (elementId) {
    re = new RegExp(
      `(<([A-Za-z][\\w-]*)\\b[^>]*\\bid=["']${escapeRegExp(elementId)}["'][^>]*)(/?)>`,
      'i',
    );
  }
  if (!re || !re.test(html)) return html;

  return html.replace(re, (_full, open: string, _tag: string, selfClose: string) => {
    const nextOpen = mergePositionDeltaIntoOpenTag(open, opts.dx, opts.dy);
    return `${nextOpen}${selfClose}>`;
  });
}

/** Resolve element id from a simple #id selector. */
export function elementIdFromSelector(selector: string | null | undefined): string | null {
  if (!selector || typeof selector !== 'string') return null;
  const m = /^#([A-Za-z][\w\-:.]*)$/.exec(selector.trim());
  return m?.[1] ?? null;
}
