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

function findOpenTagRe(opts: {
  neosId?: string | null;
  elementId?: string | null;
}): RegExp | null {
  const neosId = opts.neosId && !/[^\w-]/.test(opts.neosId) ? opts.neosId : '';
  const elementId =
    opts.elementId && /^[A-Za-z][\w\-:.]*$/.test(opts.elementId) ? opts.elementId : '';
  if (neosId) {
    return new RegExp(
      `(<([A-Za-z][\\w-]*)\\b[^>]*\\bdata-neos-id=["']${escapeRegExp(neosId)}["'][^>]*)(/?)>`,
      'i',
    );
  }
  if (elementId) {
    return new RegExp(
      `(<([A-Za-z][\\w-]*)\\b[^>]*\\bid=["']${escapeRegExp(elementId)}["'][^>]*)(/?)>`,
      'i',
    );
  }
  return null;
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
  const re = findOpenTagRe(opts);
  if (!re || !re.test(html)) return html;

  return html.replace(re, (_full, open: string, _tag: string, selfClose: string) => {
    const nextOpen = mergePositionDeltaIntoOpenTag(open, opts.dx, opts.dy);
    return `${nextOpen}${selfClose}>`;
  });
}

/**
 * Merge width/height delta into open-tag style (v0.7 M0 resize).
 * Uses baseWidth/baseHeight when style has no explicit px size.
 */
export function mergeSizeDeltaIntoOpenTag(
  open: string,
  opts: { dw: number; dh: number; baseWidth?: number; baseHeight?: number },
): string {
  const { dw, dh, baseWidth = 0, baseHeight = 0 } = opts;
  if (!Number.isFinite(dw) || !Number.isFinite(dh)) return open;
  if (dw === 0 && dh === 0) return open;

  const styleMatch = /\bstyle=(["'])([\s\S]*?)\1/i.exec(open);
  const map = styleMatch ? parseStyleAttr(styleMatch[2] ?? '') : {};
  const w0 = parsePx(map.width) || (baseWidth > 0 ? baseWidth : 0);
  const h0 = parsePx(map.height) || (baseHeight > 0 ? baseHeight : 0);
  const w = Math.max(8, Math.round(w0 + dw));
  const h = Math.max(8, Math.round(h0 + dh));
  if (w0 + dw !== 0 || map.width) map.width = `${w}px`;
  if (h0 + dh !== 0 || map.height) map.height = `${h}px`;
  // Always write both when we have bases from bbox
  if (baseWidth > 0) map.width = `${w}px`;
  if (baseHeight > 0) map.height = `${h}px`;
  const styleStr = serializeStyle(map);
  if (styleMatch) {
    return open.replace(styleMatch[0], `style="${styleStr}"`);
  }
  return `${open} style="${styleStr}"`;
}

/**
 * Apply size delta to element matching data-neos-id or #id.
 */
export function applySizeDeltaToHtml(
  html: string,
  opts: {
    neosId?: string | null;
    elementId?: string | null;
    dw: number;
    dh: number;
    baseWidth?: number;
    baseHeight?: number;
  },
): string {
  if (!html || (opts.dw === 0 && opts.dh === 0)) return html;
  const re = findOpenTagRe(opts);
  if (!re || !re.test(html)) return html;

  return html.replace(re, (_full, open: string, _tag: string, selfClose: string) => {
    const nextOpen = mergeSizeDeltaIntoOpenTag(open, {
      dw: opts.dw,
      dh: opts.dh,
      baseWidth: opts.baseWidth,
      baseHeight: opts.baseHeight,
    });
    return `${nextOpen}${selfClose}>`;
  });
}

/** Resolve element id from a simple #id selector. */
export function elementIdFromSelector(selector: string | null | undefined): string | null {
  if (!selector || typeof selector !== 'string') return null;
  const m = /^#([A-Za-z][\w\-:.]*)$/.exec(selector.trim());
  return m?.[1] ?? null;
}

export type GroupResizeBBox = { x: number; y: number; width: number; height: number };

/**
 * Group scale from primary SE resize (v0.8 M2 + v0.8.5 uniform Shift).
 * Anchor = primary top-left (fixed). Scale sx/sy from primary base + delta.
 * When `uniform` is true (Shift held during multi-select resize), forces sx=sy
 * using the scale from the dominant pointer axis.
 * Each box gets scaled size and position relative to the anchor.
 */
export function computeGroupResizeScales(
  primary: GroupResizeBBox,
  dw: number,
  dh: number,
  opts?: { uniform?: boolean },
): { sx: number; sy: number; primaryNext: GroupResizeBBox; uniform: boolean } {
  const baseW = Math.max(1, primary.width);
  const baseH = Math.max(1, primary.height);
  const nextW = Math.max(8, Math.round(baseW + dw));
  const nextH = Math.max(8, Math.round(baseH + dh));
  let sx = nextW / baseW;
  let sy = nextH / baseH;
  const uniform = Boolean(opts?.uniform);
  if (uniform) {
    // Dominant axis chooses the locked scale (SE drag feel).
    const s = Math.abs(dw) >= Math.abs(dh) ? sx : sy;
    sx = s;
    sy = s;
    return {
      sx,
      sy,
      uniform: true,
      primaryNext: {
        x: primary.x,
        y: primary.y,
        width: Math.max(8, Math.round(baseW * s)),
        height: Math.max(8, Math.round(baseH * s)),
      },
    };
  }
  return {
    sx,
    sy,
    uniform: false,
    primaryNext: {
      x: primary.x,
      y: primary.y,
      width: nextW,
      height: nextH,
    },
  };
}

/** Scale a bbox relative to primary top-left anchor. */
export function scaleBBoxFromAnchor(
  box: GroupResizeBBox,
  anchor: { x: number; y: number },
  sx: number,
  sy: number,
): GroupResizeBBox {
  const nx = anchor.x + (box.x - anchor.x) * sx;
  const ny = anchor.y + (box.y - anchor.y) * sy;
  return {
    x: nx,
    y: ny,
    width: Math.max(8, Math.round(box.width * sx)),
    height: Math.max(8, Math.round(box.height * sy)),
  };
}

/**
 * Apply group resize to HTML for one element: size to target bbox + position delta.
 */
export function applyGroupResizeToHtml(
  html: string,
  opts: {
    neosId?: string | null;
    elementId?: string | null;
    /** Previous layout box (for dw/dh and position delta). */
    from: GroupResizeBBox;
    /** Target layout box after scale. */
    to: GroupResizeBBox;
  },
): string {
  const dw = opts.to.width - opts.from.width;
  const dh = opts.to.height - opts.from.height;
  const dx = Math.round(opts.to.x - opts.from.x);
  const dy = Math.round(opts.to.y - opts.from.y);
  let next = html;
  if (dw !== 0 || dh !== 0) {
    next = applySizeDeltaToHtml(next, {
      neosId: opts.neosId,
      elementId: opts.elementId,
      dw,
      dh,
      baseWidth: opts.from.width,
      baseHeight: opts.from.height,
    });
  }
  if (dx !== 0 || dy !== 0) {
    next = applyPositionDeltaToHtml(next, {
      neosId: opts.neosId,
      elementId: opts.elementId,
      dx,
      dy,
    });
  }
  return next;
}
