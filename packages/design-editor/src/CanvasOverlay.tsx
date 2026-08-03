/**
 * Preview canvas overlay (v0.6 M2 move + v0.7 M0 resize + v0.7 M3 multi +
 * v0.8 M2 group resize + v0.8.5 uniform Shift + peer frames).
 * Coordinates are relative to the overlay host (iframe outer box).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { computeGroupResizeScales, scaleBBoxFromAnchor } from './canvas-style.js';

export type CanvasBBox = { x: number; y: number; width: number; height: number };

/** Peer awareness frames on canvas (v0.8.5). Non-interactive dashed outlines. */
export type PeerCanvasFrame = {
  colorHint: number;
  bboxes: CanvasBBox[];
  label?: string;
  /** Collab session id — used to dedupe explicit vs measured frames. */
  sessionId?: string;
};

export type CanvasTransformEnd =
  | { kind: 'move'; dx: number; dy: number }
  | {
      kind: 'resize';
      dw: number;
      dh: number;
      baseWidth: number;
      baseHeight: number;
      /** Shift held → uniform sx=sy for multi group scale (v0.8.5). */
      uniform?: boolean;
    };

export interface CanvasOverlayProps {
  enabled: boolean;
  /** Primary selection box (move + SE resize). */
  bbox: CanvasBBox | null;
  /**
   * Secondary multi-select outlines (v0.7 M3).
   * Move applies to all; resize scales the group (v0.8 M2).
   */
  extraBboxes?: CanvasBBox[];
  /**
   * Peer multi-select / selection outlines (v0.8.5).
   * Host supplies measured bboxes; skipped when empty.
   */
  peerFrames?: PeerCanvasFrame[];
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
      /** Shift held during multi-select resize → uniform sx=sy. */
      uniform: boolean;
    };

function validBbox(b: CanvasBBox | null | undefined): b is CanvasBBox {
  return Boolean(b && b.width > 0 && b.height > 0);
}

function peerStroke(colorHint: number): string {
  const h = ((Number.isFinite(colorHint) ? colorHint : 220) % 360 + 360) % 360;
  return `hsl(${h} 70% 55%)`;
}

function peerFill(colorHint: number): string {
  const h = ((Number.isFinite(colorHint) ? colorHint : 220) % 360 + 360) % 360;
  return `hsl(${h} 70% 55% / 0.08)`;
}

function renderPeerFrames(frames: PeerCanvasFrame[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  frames.forEach((peer, pi) => {
    const boxes = peer.bboxes.filter(validBbox);
    if (!boxes.length) return;
    const stroke = peerStroke(peer.colorHint);
    const fill = peerFill(peer.colorHint);
    boxes.forEach((b, bi) => {
      nodes.push(
        <div
          key={`peer-${pi}-${bi}-${Math.round(b.x)}-${Math.round(b.y)}`}
          data-testid="canvas-overlay-peer-frame"
          data-color-hint={String(peer.colorHint)}
          role="presentation"
          style={{
            position: 'absolute',
            left: b.x,
            top: b.y,
            width: b.width,
            height: b.height,
            boxSizing: 'border-box',
            border: `2px dashed ${stroke}`,
            background: fill,
            pointerEvents: 'none',
            borderRadius: 2,
          }}
          title={peer.label ? `Peer: ${peer.label}` : 'Peer selection'}
        />,
      );
    });
    if (peer.label && boxes[0]) {
      const b0 = boxes[0];
      nodes.push(
        <span
          key={`peer-label-${pi}`}
          data-testid="canvas-overlay-peer-label"
          style={{
            position: 'absolute',
            left: b0.x,
            top: Math.max(0, b0.y - 16),
            fontSize: 9,
            padding: '0 4px',
            borderRadius: 3,
            background: stroke,
            color: '#fff',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            maxWidth: 120,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {peer.label}
        </span>,
      );
    }
  });
  return nodes;
}

export function CanvasOverlay({
  enabled,
  bbox,
  extraBboxes = [],
  peerFrames = [],
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
  const multiCountRef = useRef(1);

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
      // Multi-select only: Shift locks uniform sx=sy (v0.8.5)
      const uniform = multiCountRef.current > 1 && Boolean(e.shiftKey);
      setGesture({ ...g, dw, dh, uniform });
    }
  }, []);

  const onMouseUp = useCallback(
    (e: MouseEvent) => {
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
          const uniform = multiCountRef.current > 1 && Boolean(e.shiftKey || g.uniform);
          onTransformEndRef.current?.({
            kind: 'resize',
            dw,
            dh,
            baseWidth: g.baseW,
            baseHeight: g.baseH,
            uniform: uniform || undefined,
          });
        }
      }
    },
    [onMouseMove],
  );

  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const extras = (extraBboxes ?? []).filter(validBbox);
  const multiCount = bbox && validBbox(bbox) ? 1 + extras.length : 0;
  multiCountRef.current = multiCount || 1;

  if (!enabled || !validBbox(bbox)) {
    // Still allow peer-only frames when no local selection
    const peersOnly = (peerFrames ?? []).filter((p) => p.bboxes.some(validBbox));
    if (!enabled || peersOnly.length === 0) return null;
    return (
      <div
        className={className}
        data-testid="canvas-overlay"
        data-peer-only="1"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 5,
          ...style,
        }}
      >
        {renderPeerFrames(peersOnly)}
      </div>
    );
  }

  const moveDx = gesture?.mode === 'move' ? gesture.dx : 0;
  const moveDy = gesture?.mode === 'move' ? gesture.dy : 0;

  const left = bbox.x + moveDx;
  const top = bbox.y + moveDy;
  let width = bbox.width;
  let height = bbox.height;
  let resizeSx = 1;
  let resizeSy = 1;
  let uniformLive = false;
  if (gesture?.mode === 'resize') {
    uniformLive = multiCount > 1 && gesture.uniform;
    const scaled = computeGroupResizeScales(bbox, gesture.dw, gesture.dh, {
      uniform: uniformLive,
    });
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
      uniform: multiCount > 1 && Boolean(e.shiftKey),
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
      data-uniform-scale={uniformLive ? '1' : undefined}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
        ...style,
      }}
    >
      {renderPeerFrames(peerFrames ?? [])}
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
            ? `Drag to move ${multiCount} selected; SE scales group (Shift = uniform)`
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
          {multiCount > 1
            ? `${multiCount} selected · Move / Scale${uniformLive ? ' · 1:1' : ''}`
            : 'Move / Resize'}
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
          title={
            multiCount > 1
              ? 'Scale group (hold Shift for uniform sx=sy)'
              : 'Resize'
          }
        />
      </div>
    </div>
  );
}
