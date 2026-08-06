/**
 * Canvas overlay helpers (v0.6 M2) — apply drag deltas as inline styles in HTML SSOT.
 * v0.9 M1: default-on (Q23), localStorage pref, align tools.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** localStorage key for user canvas overlay preference (v0.9 M1). */
export const CANVAS_OVERLAY_PREF_KEY = 'neos.canvasOverlay';

function parseBoolFlag(v: string | null | undefined): boolean | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === '1' || s === 'true' || s === 'on' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'off' || s === 'no') return false;
  return null;
}

function readEnvCanvasFlag(): boolean | null {
  try {
    const g = globalThis as {
      NEOS_CANVAS_OVERLAY?: string;
      VITE_NEOS_CANVAS_OVERLAY?: string;
      process?: { env?: Record<string, string | undefined> };
    };
    const fromG =
      parseBoolFlag(g.NEOS_CANVAS_OVERLAY)
      ?? parseBoolFlag(g.VITE_NEOS_CANVAS_OVERLAY);
    if (fromG !== null) return fromG;
    const pe = g.process?.env;
    const fromPe =
      parseBoolFlag(pe?.NEOS_CANVAS_OVERLAY)
      ?? parseBoolFlag(pe?.VITE_NEOS_CANVAS_OVERLAY);
    if (fromPe !== null) return fromPe;
  } catch {
    // ignore
  }
  try {
    const meta = import.meta as { env?: Record<string, string | undefined> };
    const e = meta.env;
    return (
      parseBoolFlag(e?.NEOS_CANVAS_OVERLAY)
      ?? parseBoolFlag(e?.VITE_NEOS_CANVAS_OVERLAY)
    );
  } catch {
    return null;
  }
}

/** Read user pref from localStorage; `null` if unset / unavailable. */
export function readCanvasOverlayPref(): boolean | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return parseBoolFlag(localStorage.getItem(CANVAS_OVERLAY_PREF_KEY));
  } catch {
    return null;
  }
}

/** Persist user canvas overlay preference (`1` / `0`). */
export function writeCanvasOverlayPref(on: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CANVAS_OVERLAY_PREF_KEY, on ? '1' : '0');
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Whether free-canvas overlay is enabled (v0.9 M1 Q23).
 *
 * Precedence:
 * 1. explicit prop (`true` / `false`)
 * 2. env `NEOS_CANVAS_OVERLAY` / `VITE_NEOS_CANVAS_OVERLAY` (`0` forces off, `1` on)
 * 3. localStorage `neos.canvasOverlay`
 * 4. **default on**
 */
export function isCanvasOverlayEnabled(explicit?: boolean | null): boolean {
  if (explicit === true) return true;
  if (explicit === false) return false;
  const env = readEnvCanvasFlag();
  if (env !== null) return env;
  const pref = readCanvasOverlayPref();
  if (pref !== null) return pref;
  return true;
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

// ─── Align / distribute (v0.9 M1) ───────────────────────────────────────────

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export type AlignableBox = GroupResizeBBox & {
  neosId?: string | null;
  elementId?: string | null;
};

export type AlignDelta = {
  neosId?: string | null;
  elementId?: string | null;
  dx: number;
  dy: number;
};

/**
 * Compute position deltas so each `others` box aligns to `primary` on `edge`.
 * Primary itself is not moved. Multi-select ≥ 2 required by host.
 */
export function computeAlignDeltas(
  primary: AlignableBox,
  others: AlignableBox[],
  edge: AlignEdge,
): AlignDelta[] {
  const out: AlignDelta[] = [];
  const pL = primary.x;
  const pT = primary.y;
  const pR = primary.x + primary.width;
  const pB = primary.y + primary.height;
  const pCx = primary.x + primary.width / 2;
  const pCy = primary.y + primary.height / 2;

  for (const box of others) {
    let dx = 0;
    let dy = 0;
    switch (edge) {
      case 'left':
        dx = pL - box.x;
        break;
      case 'center':
        dx = pCx - (box.x + box.width / 2);
        break;
      case 'right':
        dx = pR - (box.x + box.width);
        break;
      case 'top':
        dy = pT - box.y;
        break;
      case 'middle':
        dy = pCy - (box.y + box.height / 2);
        break;
      case 'bottom':
        dy = pB - (box.y + box.height);
        break;
      default:
        break;
    }
    dx = Math.round(dx);
    dy = Math.round(dy);
    if (dx === 0 && dy === 0) continue;
    out.push({
      neosId: box.neosId,
      elementId: box.elementId,
      dx,
      dy,
    });
  }
  return out;
}

/**
 * Apply align deltas to HTML (primary stays; others move).
 */
export function applyAlignToHtml(
  html: string,
  primary: AlignableBox,
  others: AlignableBox[],
  edge: AlignEdge,
): string {
  const deltas = computeAlignDeltas(primary, others, edge);
  let next = html;
  for (const d of deltas) {
    next = applyPositionDeltaToHtml(next, {
      neosId: d.neosId,
      elementId: d.elementId,
      dx: d.dx,
      dy: d.dy,
    });
  }
  return next;
}

/**
 * Evenly distribute selected boxes along an axis between first and last (by position).
 * Needs ≥ 3 boxes with bboxes. Returns position deltas (absolute moves via dx/dy).
 */
export function computeDistributeDeltas(
  boxes: AlignableBox[],
  axis: 'horizontal' | 'vertical',
): AlignDelta[] {
  if (boxes.length < 3) return [];
  const sorted = [...boxes].sort((a, b) =>
    axis === 'horizontal' ? a.x - b.x : a.y - b.y,
  );
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const n = sorted.length;
  const out: AlignDelta[] = [];

  if (axis === 'horizontal') {
    const span = last.x - first.x;
    if (span <= 0) return [];
    const step = span / (n - 1);
    for (let i = 1; i < n - 1; i++) {
      const box = sorted[i]!;
      const targetX = first.x + step * i;
      const dx = Math.round(targetX - box.x);
      if (dx === 0) continue;
      out.push({ neosId: box.neosId, elementId: box.elementId, dx, dy: 0 });
    }
  } else {
    const span = last.y - first.y;
    if (span <= 0) return [];
    const step = span / (n - 1);
    for (let i = 1; i < n - 1; i++) {
      const box = sorted[i]!;
      const targetY = first.y + step * i;
      const dy = Math.round(targetY - box.y);
      if (dy === 0) continue;
      out.push({ neosId: box.neosId, elementId: box.elementId, dx: 0, dy });
    }
  }
  return out;
}

export function applyDistributeToHtml(
  html: string,
  boxes: AlignableBox[],
  axis: 'horizontal' | 'vertical',
): string {
  const deltas = computeDistributeDeltas(boxes, axis);
  let next = html;
  for (const d of deltas) {
    next = applyPositionDeltaToHtml(next, {
      neosId: d.neosId,
      elementId: d.elementId,
      dx: d.dx,
      dy: d.dy,
    });
  }
  return next;
}
