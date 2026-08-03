/**
 * Preview canvas overlay (v0.6 M2 move + v0.7 M0 resize + v0.7 M3 multi + v0.8 M2 group resize).
 * Coordinates are relative to the overlay host (iframe outer box).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { computeGroupResizeScales, scaleBBoxFromAnchor } from './canvas-style.js';

export type CanvasBBox = { x: number; y: number; width: number; height: number };

export type CanvasTransformEnd =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'resize'; dw: number; dh: number; baseWidth: number; baseHeight: number };

export interface CanvasOverlayProps {
  enabled: boolean;
  /** Primary selection box (move + SE resize). */
  bbox: CanvasBBox | null;
  /**
   * Secondary multi-select outlines (v0.7 M3).
   * Move applies to all; resize scales the group (v0.8 M2).
   */
  extraBboxes?: CanvasBBox[];
  /** @deprecated prefer onTransformEnd */
  onDragEnd?: (dx: number, dy: number) => void;
  onTransformEnd?: (t: CanvasTransformEnd) => void;
  /** Live drag preview (optional). */
  onDrag?: (dx: number, dy: number) => void;
  className?: string;
  style?: CSSProperties;
}

type Gesture =
  | { mode: 'move'; startX: number; startY: number; dx: number; dy: number }
  | {
      mode: 'resize';
      startX: number;
      startY: number;
      dw: number;
      dh: number;
      baseW: number;
      baseH: number;
    };

function validBbox(b: CanvasBBox | null | undefined): b is CanvasBBox {
  return Boolean(b && b.width > 0 && b.height > 0);
}

export function CanvasOverlay({
  enabled,
  bbox,
  extraBboxes = [],
  onDragEnd,
  onTransformEnd,
  onDrag,
  className,
  style,
}: CanvasOverlayProps) {
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const gestureRef = useRef(gesture);
  gestureRef.current = gesture;
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;
  const onTransformEndRef = useRef(onTransformEnd);
  onTransformEndRef.current = onTransformEnd;

  const onMouseMove = useCallback((e: MouseEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    if (g.mode === 'move') {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      setGesture({ ...g, dx, dy });
      onDragRef.current?.(dx, dy);
    } else {
      const dw = e.clientX - g.startX;
      const dh = e.clientY - g.startY;
      setGesture({ ...g, dw, dh });
    }
  }, []);

  const onMouseUp = useCallback(() => {
    const g = gestureRef.current;
    setGesture(null);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    if (!g) return;
    if (g.mode === 'move') {
      const dx = Math.round(g.dx);
      const dy = Math.round(g.dy);
      if (dx !== 0 || dy !== 0) {
        onTransformEndRef.current?.({ kind: 'move', dx, dy });
        onDragEndRef.current?.(dx, dy);
      }
    } else {
      const dw = Math.round(g.dw);
      const dh = Math.round(g.dh);
      if (dw !== 0 || dh !== 0) {
        onTransformEndRef.current?.({
          kind: 'resize',
          dw,
          dh,
          baseWidth: g.baseW,
          baseHeight: g.baseH,
        });
      }
    }
  }, [onMouseMove]);

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  if (!enabled || !validBbox(bbox)) {
    return null;
  }

  const extras = extraBboxes.filter(validBbox);
  const multiCount = 1 + extras.length;
  const moveDx = gesture?.mode === 'move' ? gesture.dx : 0;
  const moveDy = gesture?.mode === 'move' ? gesture.dy : 0;

  let left = bbox.x + moveDx;
  let top = bbox.y + moveDy;
  let width = bbox.width;
  let height = bbox.height;
  let resizeSx = 1;
  let resizeSy = 1;
  if (gesture?.mode === 'resize') {
    const scaled = computeGroupResizeScales(bbox, gesture.dw, gesture.dh);
    width = scaled.primaryNext.width;
    height = scaled.primaryNext.height;
    resizeSx = scaled.sx;
    resizeSy = scaled.sy;
  }

  const startMove = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setGesture({ mode: 'move', startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setGesture({
      mode: 'resize',
      startX: e.clientX,
      startY: e.clientY,
      dw: 0,
      dh: 0,
      baseW: bbox.width,
      baseH: bbox.height,
    });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      className={className}
      data-testid="canvas-overlay"
      data-multi-count={multiCount}
      data-group-resize={multiCount > 1 ? '1' : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
        ...style,
      }}
    >
      {extras.map((b, i) => {
        const shown =
          gesture?.mode === 'resize'
            ? scaleBBoxFromAnchor(b, { x: bbox.x, y: bbox.y }, resizeSx, resizeSy)
            : {
                x: b.x + moveDx,
                y: b.y + moveDy,
                width: b.width,
                height: b.height,
              };
        return (
          <div
            key={`extra-${i}-${Math.round(b.x)}-${Math.round(b.y)}`}
            data-testid="canvas-overlay-extra-frame"
            role="presentation"
            style={{
              position: 'absolute',
              left: shown.x,
              top: shown.y,
              width: shown.width,
              height: shown.height,
              boxSizing: 'border-box',
              border: '2px dashed #a5b4fc',
              background: 'rgba(165, 180, 252, 0.06)',
              pointerEvents: 'none',
              borderRadius: 2,
            }}
            title="Multi-selected"
          />
        );
      })}
      <div
        data-testid="canvas-overlay-frame"
        role="presentation"
        onMouseDown={startMove}
        style={{
          position: 'absolute',
          left,
          top,
          width,
          height,
          boxSizing: 'border-box',
          border: '2px solid #818cf8',
          background: 'rgba(129, 140, 248, 0.08)',
          cursor: 'move',
          pointerEvents: 'auto',
          borderRadius: 2,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
        }}
        title={
          multiCount > 1
            ? `Drag to move ${multiCount} selected; SE corner scales group`
            : 'Drag to reposition; SE corner to resize'
        }
      >
        <span
          data-testid="canvas-overlay-handle"
          style={{
            position: 'absolute',
            top: -18,
            left: 0,
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 4,
            background: '#6366f1',
            color: '#fff',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {multiCount > 1 ? `${multiCount} selected · Move / Scale` : 'Move / Resize'}
        </span>
        <div
          data-testid="canvas-overlay-resize-se"
          role="presentation"
          onMouseDown={startResize}
          style={{
            position: 'absolute',
            right: -5,
            bottom: -5,
            width: 12,
            height: 12,
            borderRadius: 2,
            background: '#818cf8',
            border: '1px solid #fff',
            cursor: 'nwse-resize',
            pointerEvents: 'auto',
            boxSizing: 'border-box',
          }}
          title={multiCount > 1 ? 'Scale group' : 'Resize'}
        />
      </div>
    </div>
  );
}
