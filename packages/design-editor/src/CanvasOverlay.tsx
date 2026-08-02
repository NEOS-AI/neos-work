/**
 * Preview canvas overlay (v0.6 M2 move + v0.7 M0 resize).
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

export type CanvasBBox = { x: number; y: number; width: number; height: number };

export type CanvasTransformEnd =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'resize'; dw: number; dh: number; baseWidth: number; baseHeight: number };

export interface CanvasOverlayProps {
  enabled: boolean;
  /** Selection box in overlay/host coordinates. */
  bbox: CanvasBBox | null;
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

export function CanvasOverlay({
  enabled,
  bbox,
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

  if (!enabled || !bbox || bbox.width <= 0 || bbox.height <= 0) {
    return null;
  }

  let left = bbox.x;
  let top = bbox.y;
  let width = bbox.width;
  let height = bbox.height;
  if (gesture?.mode === 'move') {
    left += gesture.dx;
    top += gesture.dy;
  } else if (gesture?.mode === 'resize') {
    width = Math.max(8, bbox.width + gesture.dw);
    height = Math.max(8, bbox.height + gesture.dh);
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
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
        ...style,
      }}
    >
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
        title="Drag to reposition; SE corner to resize"
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
          Move / Resize
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
          title="Resize"
        />
      </div>
    </div>
  );
}
