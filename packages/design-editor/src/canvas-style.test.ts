import { describe, expect, it } from 'vitest';
import {
  applyAlignToHtml,
  applyDistributeToHtml,
  applyGroupResizeToHtml,
  applyPositionDeltaToHtml,
  applySizeDeltaToHtml,
  CANVAS_OVERLAY_PREF_KEY,
  computeAlignDeltas,
  computeDistributeDeltas,
  computeGroupResizeScales,
  elementIdFromSelector,
  isCanvasOverlayEnabled,
  mergePositionDeltaIntoOpenTag,
  mergeSizeDeltaIntoOpenTag,
  readCanvasOverlayPref,
  scaleBBoxFromAnchor,
  writeCanvasOverlayPref,
} from './canvas-style.js';

describe('canvas-style', () => {
  it('isCanvasOverlayEnabled: default on, explicit, env force off, pref (v0.9 M1)', () => {
    const g = globalThis as { NEOS_CANVAS_OVERLAY?: string };
    const prevEnv = g.NEOS_CANVAS_OVERLAY;
    delete g.NEOS_CANVAS_OVERLAY;
    try {
      localStorage.removeItem(CANVAS_OVERLAY_PREF_KEY);
    } catch {
      // ignore
    }

    expect(isCanvasOverlayEnabled(true)).toBe(true);
    expect(isCanvasOverlayEnabled(false)).toBe(false);
    // Q23 default on when no env/pref
    expect(isCanvasOverlayEnabled()).toBe(true);

    g.NEOS_CANVAS_OVERLAY = '0';
    expect(isCanvasOverlayEnabled()).toBe(false);
    g.NEOS_CANVAS_OVERLAY = '1';
    expect(isCanvasOverlayEnabled()).toBe(true);
    delete g.NEOS_CANVAS_OVERLAY;

    writeCanvasOverlayPref(false);
    expect(readCanvasOverlayPref()).toBe(false);
    expect(isCanvasOverlayEnabled()).toBe(false);
    writeCanvasOverlayPref(true);
    expect(isCanvasOverlayEnabled()).toBe(true);

    try {
      localStorage.removeItem(CANVAS_OVERLAY_PREF_KEY);
    } catch {
      // ignore
    }
    if (prevEnv === undefined) delete g.NEOS_CANVAS_OVERLAY;
    else g.NEOS_CANVAS_OVERLAY = prevEnv;
  });

  it('mergePositionDeltaIntoOpenTag sets relative left/top', () => {
    const o = mergePositionDeltaIntoOpenTag('<div class="x"', 10, -5);
    expect(o).toMatch(/position:\s*relative/);
    expect(o).toMatch(/left:\s*10px/);
    expect(o).toMatch(/top:\s*-5px/);
  });

  it('merge accumulates existing left/top', () => {
    const o = mergePositionDeltaIntoOpenTag(
      '<div style="position: relative; left: 4px; top: 2px"',
      3,
      1,
    );
    expect(o).toMatch(/left:\s*7px/);
    expect(o).toMatch(/top:\s*3px/);
  });

  it('applyPositionDeltaToHtml by data-neos-id', () => {
    const html = '<section data-neos-id="e1"><h1>Hi</h1></section>';
    const next = applyPositionDeltaToHtml(html, { neosId: 'e1', dx: 12, dy: 8 });
    expect(next).toMatch(/data-neos-id="e1"/);
    expect(next).toMatch(/left:\s*12px/);
    expect(next).toMatch(/top:\s*8px/);
  });

  it('applyPositionDeltaToHtml by element id', () => {
    const html = '<div id="hero">X</div>';
    const next = applyPositionDeltaToHtml(html, { elementId: 'hero', dx: 5, dy: 0 });
    expect(next).toMatch(/id="hero"/);
    expect(next).toMatch(/left:\s*5px/);
  });

  it('elementIdFromSelector', () => {
    expect(elementIdFromSelector('#hero')).toBe('hero');
    expect(elementIdFromSelector('div > p')).toBeNull();
  });

  it('mergeSizeDeltaIntoOpenTag uses base bbox sizes', () => {
    const o = mergeSizeDeltaIntoOpenTag('<div id="x"', {
      dw: 20,
      dh: 10,
      baseWidth: 100,
      baseHeight: 50,
    });
    expect(o).toMatch(/width:\s*120px/);
    expect(o).toMatch(/height:\s*60px/);
  });

  it('applySizeDeltaToHtml by data-neos-id', () => {
    const html = '<section data-neos-id="e1">Hi</section>';
    const next = applySizeDeltaToHtml(html, {
      neosId: 'e1',
      dw: 5,
      dh: 5,
      baseWidth: 80,
      baseHeight: 40,
    });
    expect(next).toMatch(/width:\s*85px/);
    expect(next).toMatch(/height:\s*45px/);
  });

  it('computeGroupResizeScales and scaleBBoxFromAnchor (v0.8 M2)', () => {
    const primary = { x: 10, y: 20, width: 100, height: 50 };
    const { sx, sy, primaryNext, uniform } = computeGroupResizeScales(primary, 100, 50);
    expect(sx).toBe(2);
    expect(sy).toBe(2);
    expect(uniform).toBe(false);
    expect(primaryNext).toEqual({ x: 10, y: 20, width: 200, height: 100 });

    const child = scaleBBoxFromAnchor({ x: 60, y: 40, width: 20, height: 10 }, { x: 10, y: 20 }, sx, sy);
    // offset (50, 20) * 2 → (100, 40) + anchor → (110, 60); size * 2
    expect(child.x).toBe(110);
    expect(child.y).toBe(60);
    expect(child.width).toBe(40);
    expect(child.height).toBe(20);
  });

  it('computeGroupResizeScales uniform Shift locks sx=sy (v0.8.5)', () => {
    const primary = { x: 0, y: 0, width: 100, height: 50 };
    // Free: dw=100 → sx=2, dh=0 → sy=1
    const free = computeGroupResizeScales(primary, 100, 0);
    expect(free.sx).toBe(2);
    expect(free.sy).toBe(1);
    expect(free.uniform).toBe(false);

    // Uniform: dominant axis is width → s=2 for both
    const uni = computeGroupResizeScales(primary, 100, 0, { uniform: true });
    expect(uni.uniform).toBe(true);
    expect(uni.sx).toBe(2);
    expect(uni.sy).toBe(2);
    expect(uni.primaryNext).toEqual({ x: 0, y: 0, width: 200, height: 100 });

    // Dominant height: dw=10, dh=50 → sy = 100/50 = 2
    const uniH = computeGroupResizeScales(primary, 10, 50, { uniform: true });
    expect(uniH.sx).toBe(2);
    expect(uniH.sy).toBe(2);
    expect(uniH.primaryNext.width).toBe(200);
    expect(uniH.primaryNext.height).toBe(100);
  });

  it('applyGroupResizeToHtml scales size and position', () => {
    const html = '<div data-neos-id="c1" style="position: relative; left: 50px; top: 20px">X</div>';
    const next = applyGroupResizeToHtml(html, {
      neosId: 'c1',
      from: { x: 50, y: 20, width: 40, height: 20 },
      to: { x: 90, y: 40, width: 80, height: 40 },
    });
    expect(next).toMatch(/width:\s*80px/);
    expect(next).toMatch(/height:\s*40px/);
    expect(next).toMatch(/left:\s*90px/);
    expect(next).toMatch(/top:\s*40px/);
  });

  it('computeAlignDeltas aligns others to primary (v0.9 M1)', () => {
    const primary = {
      neosId: 'p',
      x: 100,
      y: 50,
      width: 40,
      height: 20,
    };
    const others = [
      { neosId: 'a', x: 10, y: 80, width: 20, height: 10 },
    ];
    const left = computeAlignDeltas(primary, others, 'left');
    expect(left).toEqual([{ neosId: 'a', elementId: undefined, dx: 90, dy: 0 }]);
    const top = computeAlignDeltas(primary, others, 'top');
    expect(top[0]?.dy).toBe(-30);
    const center = computeAlignDeltas(primary, others, 'center');
    // primary cx=120, other cx=20 → dx=100
    expect(center[0]?.dx).toBe(100);
  });

  it('applyAlignToHtml moves non-primary elements', () => {
    const html =
      '<div data-neos-id="p" style="position:relative;left:100px;top:0px"></div>'
      + '<div data-neos-id="a" style="position:relative;left:10px;top:0px"></div>';
    const next = applyAlignToHtml(
      html,
      { neosId: 'p', x: 100, y: 0, width: 40, height: 20 },
      [{ neosId: 'a', x: 10, y: 0, width: 20, height: 10 }],
      'left',
    );
    expect(next).toMatch(/data-neos-id="a"[^>]*left:\s*100px/);
  });

  it('computeDistributeDeltas spaces middle boxes', () => {
    const boxes = [
      { neosId: 'a', x: 0, y: 0, width: 10, height: 10 },
      { neosId: 'b', x: 10, y: 0, width: 10, height: 10 },
      { neosId: 'c', x: 100, y: 0, width: 10, height: 10 },
    ];
    const d = computeDistributeDeltas(boxes, 'horizontal');
    // middle b should move to x=50
    expect(d.some((x) => x.neosId === 'b' && x.dx === 40)).toBe(true);
    const html = applyDistributeToHtml(
      '<i data-neos-id="a" style="left:0px"></i>'
        + '<i data-neos-id="b" style="left:10px"></i>'
        + '<i data-neos-id="c" style="left:100px"></i>',
      boxes,
      'horizontal',
    );
    expect(html).toMatch(/data-neos-id="b"[^>]*left:\s*50px/);
  });
});
