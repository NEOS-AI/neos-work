/**
 * Preview canvas overlay (v0.6 M2) — drag selected frame to offset inline styles.
 * Coordinates are relative to the overlay host (iframe outer box).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

export type CanvasBBox = { x: number; y: number; width: number; height: number };

export interface CanvasOverlayProps {
  enabled: boolean;
  /** Selection box in overlay/host coordinates. */
  bbox: CanvasBBox | null;
  onDragEnd?: (dx: number, dy: number) => void;
  /** Live drag preview (optional). */
  onDrag?: (dx: number, dy: number) => void;
  className?: string;
  style?: CSSProperties;
}

export function CanvasOverlay({
  enabled,
  bbox,
  onDragEnd,
  onDrag,
  className,
  style,
}: CanvasOverlayProps) {
  const [drag, setDrag] = useState<{
    startX: number;
    startY: number;
    dx: number;
    dy: number;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      setDrag({ ...d, dx, dy });
      onDrag?.(dx, dy);
    },
    [onDrag],
  );

  const onMouseUp = useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    const dx = Math.round(d.dx);
    const dy = Math.round(d.dy);
    setDrag(null);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    if (dx !== 0 || dy !== 0) onDragEnd?.(dx, dy);
  }, [onDragEnd, onMouseMove]);

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  if (!enabled || !bbox || bbox.width <= 0 || bbox.height <= 0) {
    return null;
  }

  const dx = drag?.dx ?? 0;
  const dy = drag?.dy ?? 0;

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
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDrag({ startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 });
          window.addEventListener('mousemove', onMouseMove);
          window.addEventListener('mouseup', onMouseUp);
        }}
        style={{
          position: 'absolute',
          left: bbox.x + dx,
          top: bbox.y + dy,
          width: bbox.width,
          height: bbox.height,
          boxSizing: 'border-box',
          border: '2px solid #818cf8',
          background: 'rgba(129, 140, 248, 0.08)',
          cursor: 'move',
          pointerEvents: 'auto',
          borderRadius: 2,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
        }}
        title="Drag to reposition (canvas overlay)"
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
          Move
        </span>
      </div>
    </div>
  );
}
