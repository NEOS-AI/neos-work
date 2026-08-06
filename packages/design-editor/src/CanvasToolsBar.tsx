/**
 * Canvas overlay toggle + align / distribute / z-order tools (v0.9 M1).
 */

import type { CSSProperties } from 'react';
import type { AlignEdge } from './canvas-style.js';
import type { ZOrderOp } from './html-layers.js';

export type CanvasToolsLabels = {
  canvasOn: string;
  canvasOff: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  alignTop: string;
  alignMiddle: string;
  alignBottom: string;
  distributeH: string;
  distributeV: string;
  zForward: string;
  zBackward: string;
  zFront: string;
  zBack: string;
};

export type CanvasToolsBarProps = {
  htmlLike: boolean;
  canvasOn: boolean;
  hasSelection: boolean;
  multiSelectCount: number;
  hasPrimaryBbox: boolean;
  labels: CanvasToolsLabels;
  onToggleCanvas: () => void;
  onAlign: (edge: AlignEdge) => void;
  onDistribute: (axis: 'horizontal' | 'vertical') => void;
  onZOrder: (op: ZOrderOp) => void;
};

const toolBtnStyle: CSSProperties = {
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid var(--border-primary, #333)',
  background: 'transparent',
  color: 'var(--text-secondary, #ccc)',
  cursor: 'pointer',
  lineHeight: 1.2,
};

const ALIGN_EDGES: Array<{ edge: AlignEdge; icon: string; labelKey: keyof CanvasToolsLabels }> = [
  { edge: 'left', icon: '⫷', labelKey: 'alignLeft' },
  { edge: 'center', icon: '☰', labelKey: 'alignCenter' },
  { edge: 'right', icon: '⫸', labelKey: 'alignRight' },
  { edge: 'top', icon: '⬆', labelKey: 'alignTop' },
  { edge: 'middle', icon: '⬌', labelKey: 'alignMiddle' },
  { edge: 'bottom', icon: '⬇', labelKey: 'alignBottom' },
];

const Z_OPS: Array<{ op: ZOrderOp; icon: string; labelKey: keyof CanvasToolsLabels }> = [
  { op: 'forward', icon: '↑', labelKey: 'zForward' },
  { op: 'backward', icon: '↓', labelKey: 'zBackward' },
  { op: 'front', icon: '⤒', labelKey: 'zFront' },
  { op: 'back', icon: '⤓', labelKey: 'zBack' },
];

export function CanvasToolsBar({
  htmlLike,
  canvasOn,
  hasSelection,
  multiSelectCount,
  hasPrimaryBbox,
  labels,
  onToggleCanvas,
  onAlign,
  onDistribute,
  onZOrder,
}: CanvasToolsBarProps) {
  if (!htmlLike) return null;

  return (
    <>
      <button
        type="button"
        data-testid="canvas-overlay-toggle"
        title={
          canvasOn
            ? 'Canvas overlay on (click to disable)'
            : 'Canvas overlay off (click to enable)'
        }
        onClick={onToggleCanvas}
        style={{
          fontSize: 10,
          padding: '2px 8px',
          borderRadius: 4,
          border: '1px solid var(--border-primary, #333)',
          background: canvasOn ? 'rgba(165,180,252,0.15)' : 'transparent',
          color: canvasOn ? '#a5b4fc' : 'var(--text-muted, #888)',
          cursor: 'pointer',
        }}
      >
        {canvasOn ? labels.canvasOn : labels.canvasOff}
      </button>
      {canvasOn && (
        <span
          data-testid="canvas-overlay-badge"
          title="Canvas overlay: select an element, then drag the frame"
          style={{ fontSize: 10, color: '#a5b4fc' }}
        >
          Canvas
        </span>
      )}
      {canvasOn && hasSelection && (
        <div
          data-testid="canvas-tools"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}
        >
          {multiSelectCount >= 2 &&
            ALIGN_EDGES.map(({ edge, icon, labelKey }) => (
              <button
                key={edge}
                type="button"
                data-testid={`canvas-align-${edge}`}
                title={labels[labelKey]}
                disabled={!hasPrimaryBbox}
                onClick={() => onAlign(edge)}
                style={toolBtnStyle}
              >
                {icon}
              </button>
            ))}
          {multiSelectCount >= 3 && (
            <>
              <button
                type="button"
                data-testid="canvas-distribute-h"
                title={labels.distributeH}
                onClick={() => onDistribute('horizontal')}
                style={toolBtnStyle}
              >
                ⇄
              </button>
              <button
                type="button"
                data-testid="canvas-distribute-v"
                title={labels.distributeV}
                onClick={() => onDistribute('vertical')}
                style={toolBtnStyle}
              >
                ⇅
              </button>
            </>
          )}
          {Z_OPS.map(({ op, icon, labelKey }) => (
            <button
              key={op}
              type="button"
              data-testid={`canvas-z-${op}`}
              title={labels[labelKey]}
              onClick={() => onZOrder(op)}
              style={toolBtnStyle}
            >
              {icon}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
