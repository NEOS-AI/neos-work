import { describe, expect, it } from 'vitest';
import {
  applyPositionDeltaToHtml,
  applySizeDeltaToHtml,
  elementIdFromSelector,
  isCanvasOverlayEnabled,
  mergePositionDeltaIntoOpenTag,
  mergeSizeDeltaIntoOpenTag,
} from './canvas-style.js';

describe('canvas-style', () => {
  it('isCanvasOverlayEnabled respects explicit and env', () => {
    expect(isCanvasOverlayEnabled(true)).toBe(true);
    expect(isCanvasOverlayEnabled(false)).toBe(false);
    const g = globalThis as { NEOS_CANVAS_OVERLAY?: string };
    const prev = g.NEOS_CANVAS_OVERLAY;
    g.NEOS_CANVAS_OVERLAY = '1';
    expect(isCanvasOverlayEnabled()).toBe(true);
    g.NEOS_CANVAS_OVERLAY = prev;
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
});
