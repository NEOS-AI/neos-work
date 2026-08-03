/**
 * Design Editor chrome: Layers | Preview/Code/Split/Inspect + selection (Task 1c).
 * Host supplies buffer state and save; package owns panes (Q9 CodeMirror).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LayerNode, SelectionState } from '@neos-work/shared';
import { CodeEditor } from './CodeEditor.js';
import { DEVICE_PRESETS } from './device-presets.js';
import { PreviewFrame, postToPreview, toPreviewDocument } from './PreviewFrame.js';
import { isConflict, isDirty, simpleDiffLines, type EditorBufferState } from './dirty-state.js';
import { LayersPanel } from './LayersPanel.js';
import {
  bridgeTreeToLayers,
  findLayerBySelector,
  parseHtmlToLayerTree,
  stampNeosIds,
  toggleLockByNeosId,
  toggleVisibilityByNeosId,
} from './html-layers.js';
import { isJsxPath, parseJsxToLayerTree } from './jsx-layers.js';
import {
  CanvasOverlay,
  type CanvasTransformEnd,
  type PeerCanvasFrame,
} from './CanvasOverlay.js';
import {
  applyGroupResizeToHtml,
  applyPositionDeltaToHtml,
  applySizeDeltaToHtml,
  computeGroupResizeScales,
  elementIdFromSelector,
  isCanvasOverlayEnabled,
  scaleBBoxFromAnchor,
} from './canvas-style.js';
import {
  bboxesFromMultiEntries,
  editContextFromSelection,
  multiEntriesFromBridge,
  selectionFromBridge,
  selectionFromLayer,
  selectionWithMulti,
  splitPrimaryExtras,
  toggleMultiSelectLayer,
  type MultiSelectEntry,
} from './selection-state.js';
import type { BridgeInboundMessage, BridgeSelectPayload } from './bridge-types.js';

export type DesignEditorMode = 'preview' | 'code' | 'split' | 'inspect';

/** Cap for lightweight canvas-transform undo stack (v0.8.5). */
export const CANVAS_UNDO_CAP = 20;

export interface DesignEditorProps {
  buffer: EditorBufferState;
  mode?: DesignEditorMode;
  onModeChange?: (mode: DesignEditorMode) => void;
  onEdit?: (content: string) => void;
  onSave?: () => void;
  saving?: boolean;
  labels?: {
    preview?: string;
    code?: string;
    split?: string;
    inspect?: string;
    save?: string;
    dirty?: string;
    conflictTitle?: string;
    keepMine?: string;
    takeAgent?: string;
    showDiff?: string;
    dismissDiff?: string;
    layers?: string;
    layersSearch?: string;
    layersEmpty?: string;
    editWithAi?: string;
    copySelector?: string;
    selection?: string;
  };
  onResolveConflict?: (choice: 'keep-mine' | 'take-agent' | 'diff', merged?: string) => void;
  /** Controlled selection (optional). */
  selection?: SelectionState | null;
  onSelectionChange?: (selection: SelectionState | null, detail?: BridgeSelectPayload | null) => void;
  /** Edit with AI from Layers / Inspect selection. */
  onEditWithAi?: (selection: SelectionState, detail?: BridgeSelectPayload | null) => void;
  /** Show Layers side panel (default true for html-like paths). */
  showLayers?: boolean;
  /**
   * Free-canvas overlay (v0.6 M2): drag selected frame → inline left/top.
   * Defaults to `isCanvasOverlayEnabled()` (NEOS_CANVAS_OVERLAY=1).
   */
  canvasOverlay?: boolean;
  /**
   * Peer selection outlines on canvas (v0.8.5).
   * Host supplies measured bboxes; empty/undefined skips drawing.
   * When `peerAwareness` is set, DesignEditor measures bboxes via the preview bridge
   * and merges with this prop (explicit frames win per sessionId if both provided).
   */
  peerCanvasFrames?: PeerCanvasFrame[];
  /**
   * Peer collab awareness (v0.8.6). Measured into canvas frames for the open HTML file.
   */
  peerAwareness?: PeerAwarenessHint[];
  className?: string;
}

/** Peer editing hint for canvas outlines (path + selectors from collab). */
export type PeerAwarenessHint = {
  sessionId: string;
  colorHint?: number;
  displayName?: string;
  path?: string | null;
  selector?: string | null;
  selectors?: string[];
};

const defaultLabels = {
  preview: 'Preview',
  code: 'Code',
  split: 'Split',
  inspect: 'Inspect',
  save: 'Save',
  dirty: 'Unsaved',
  conflictTitle: 'Disk changed while editing',
  keepMine: 'Keep mine',
  takeAgent: 'Take agent',
  showDiff: 'Diff',
  dismissDiff: 'Close diff',
  layers: 'Layers',
  layersSearch: 'Filter layers…',
  layersEmpty: 'No layers',
  editWithAi: 'Edit with AI',
  copySelector: 'Copy selector',
  selection: 'Selection',
};

function isHtmlPath(path: string | null): boolean {
  if (!path) return true;
  const p = path.toLowerCase();
  return p.endsWith('.html') || p.endsWith('.htm') || p.endsWith('.svg');
}

function isLayersPath(path: string | null): boolean {
  return isHtmlPath(path) || isJsxPath(path);
}

export function DesignEditor({
  buffer,
  mode: controlledMode,
  onModeChange,
  onEdit,
  onSave,
  saving = false,
  labels: labelsProp,
  onResolveConflict,
  selection: controlledSelection,
  onSelectionChange,
  onEditWithAi,
  showLayers: showLayersProp,
  canvasOverlay: canvasOverlayProp,
  peerCanvasFrames: peerCanvasFramesProp = [],
  peerAwareness = [],
  className,
}: DesignEditorProps) {
  const labels = { ...defaultLabels, ...labelsProp };
  const [internalMode, setInternalMode] = useState<DesignEditorMode>('split');
  const mode = controlledMode ?? internalMode;
  const setMode = (m: DesignEditorMode) => {
    onModeChange?.(m);
    if (controlledMode == null) setInternalMode(m);
  };

  const [deviceId, setDeviceId] = useState('fluid');
  const [showDiff, setShowDiff] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [bridgeLayers, setBridgeLayers] = useState<LayerNode[] | null>(null);
  const [internalSelection, setInternalSelection] = useState<SelectionState | null>(null);
  const [selectDetail, setSelectDetail] = useState<BridgeSelectPayload | null>(null);
  /** Secondary multi-select entries (primary is `selection` / selectDetail). v0.7 M3 */
  const [multiExtras, setMultiExtras] = useState<MultiSelectEntry[]>([]);
  /** Measured peer frames from bridge (v0.8.6). */
  const [measuredPeerFrames, setMeasuredPeerFrames] = useState<PeerCanvasFrame[]>([]);
  const measureReqRef = useRef(0);
  const peerMeasureMapRef = useRef<
    Map<string, { colorHint: number; label?: string; selectors: string[] }>
  >(new Map());
  const iframeHostRef = useRef<HTMLDivElement>(null);
  /** Lightweight canvas transform undo/redo (HTML snapshots only). v0.8.5 */
  const canvasUndoRef = useRef<string[]>([]);
  const canvasRedoRef = useRef<string[]>([]);
  const bufferLocalRef = useRef(buffer.local);
  bufferLocalRef.current = buffer.local;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;

  const selection =
    controlledSelection !== undefined ? controlledSelection : internalSelection;

  const setSelection = useCallback(
    (next: SelectionState | null, detail?: BridgeSelectPayload | null) => {
      if (controlledSelection === undefined) setInternalSelection(next);
      setSelectDetail(detail ?? null);
      onSelectionChange?.(next, detail ?? null);
    },
    [controlledSelection, onSelectionChange],
  );

  const clearMulti = useCallback(() => setMultiExtras([]), []);

  const postHighlightMulti = useCallback((selectors: string[]) => {
    const iframe = iframeHostRef.current?.querySelector('iframe');
    if (!iframe) return;
    if (selectors.length > 1) {
      postToPreview(iframe as HTMLIFrameElement, {
        type: 'neos.highlight-multi',
        selectors,
      });
    } else {
      postToPreview(iframe as HTMLIFrameElement, {
        type: 'neos.highlight',
        selector: selectors[0] ?? null,
      });
    }
  }, []);

  const applyMultiEntries = useCallback(
    (entries: MultiSelectEntry[]) => {
      const { primary, extras } = splitPrimaryExtras(entries);
      setMultiExtras(extras);
      if (!primary) {
        setSelection(null, null);
        postHighlightMulti([]);
        return;
      }
      // v0.8 M3: embed multiSelectors on primary for collab broadcast
      setSelection(selectionWithMulti(primary.selection, entries), primary.detail);
      const selectors = entries
        .map((e) => e.selection.selector)
        .filter((s): s is string => Boolean(s));
      postHighlightMulti(selectors);
    },
    [postHighlightMulti, setSelection],
  );

  // Drop multi + canvas undo when file path changes
  useEffect(() => {
    clearMulti();
    canvasUndoRef.current = [];
    canvasRedoRef.current = [];
  }, [buffer.path, clearMulti]);

  const dirty = isDirty(buffer);
  const conflict = isConflict(buffer);
  const htmlLike = isHtmlPath(buffer.path);
  const jsxLike = isJsxPath(buffer.path);
  const showLayers = showLayersProp ?? isLayersPath(buffer.path);
  const canvasOn = isCanvasOverlayEnabled(canvasOverlayProp) && htmlLike;

  const previewHtml = useMemo(() => {
    const base = toPreviewDocument(buffer.local, buffer.path);
    // Stamp ids so visibility/lock rewrites can target buffer HTML
    return htmlLike ? stampNeosIds(base) : base;
  }, [buffer.local, buffer.path, htmlLike]);

  const jsxParse = useMemo(
    () => (jsxLike ? parseJsxToLayerTree(buffer.local) : null),
    [buffer.local, jsxLike],
  );

  const parseLayers = useMemo(() => {
    if (htmlLike) return parseHtmlToLayerTree(previewHtml);
    if (jsxLike && jsxParse) return jsxParse.layers;
    return [];
  }, [htmlLike, jsxLike, previewHtml, jsxParse]);

  const layers = bridgeLayers ?? parseLayers;
  const layerSource = bridgeLayers
    ? 'bridge'
    : jsxLike
      ? jsxParse?.incomplete
        ? 'jsx-partial'
        : 'jsx'
      : 'parse';

  // Reset bridge tree when file/content identity changes substantially
  useEffect(() => {
    setBridgeLayers(null);
  }, [buffer.path, reloadKey]);

  const diffPreview = useMemo(() => {
    if (!buffer.pendingDisk) return null;
    return simpleDiffLines(buffer.local, buffer.pendingDisk);
  }, [buffer.local, buffer.pendingDisk]);

  const handleSave = () => {
    onSave?.();
    setReloadKey((k) => k + 1);
  };

  const inspectEnabled = mode === 'inspect';

  const handleBridgeMessage = useCallback(
    (msg: BridgeInboundMessage) => {
      if (msg.type === 'neos.dom-snapshot') {
        setBridgeLayers(bridgeTreeToLayers(msg.tree ?? []));
        return;
      }
      if (msg.type === 'neos.select' && buffer.path) {
        const payload = msg.selection;
        const layersNow = bridgeLayers ?? parseLayers;
        const resolveLayerId = (selector: string) =>
          findLayerBySelector(layersNow, selector)?.id;
        const entries = multiEntriesFromBridge(buffer.path, payload, resolveLayerId);
        // Bridge already painted multi outlines; sync React state (+ multiSelectors)
        applyMultiEntries(entries);
        return;
      }
      if (msg.type === 'neos.measure-result') {
        const req = String(msg.requestId ?? '');
        // requestId format: `${n}|${sessionId}|${sessionId}|...` or map by last measure
        const parts = req.split('|');
        const reqN = Number(parts[0]);
        if (!Number.isFinite(reqN) || reqN !== measureReqRef.current) return;
        const sessionIds = parts.slice(1).filter(Boolean);
        const results = Array.isArray(msg.results) ? msg.results : [];
        // Rebuild frames: we measured flat selectors ordered by peer groups stored in peerMeasureMapRef
        const frames: PeerCanvasFrame[] = [];
        // Prefer map order from last request meta encoded as sessionIds list matching peer groups
        // results are flat; peerMeasureMapRef holds selectors per session
        for (const sid of sessionIds) {
          const meta = peerMeasureMapRef.current.get(sid);
          if (!meta) continue;
          const bboxes: Array<{ x: number; y: number; width: number; height: number }> = [];
          for (const sel of meta.selectors) {
            const hit = results.find((r) => r.selector === sel);
            if (hit?.bbox && hit.bbox.width > 0 && hit.bbox.height > 0) {
              bboxes.push({
                x: hit.bbox.x,
                y: hit.bbox.y,
                width: hit.bbox.width,
                height: hit.bbox.height,
              });
            }
          }
          if (bboxes.length > 0) {
            frames.push({
              colorHint: meta.colorHint,
              label: meta.label,
              bboxes,
            });
          }
        }
        setMeasuredPeerFrames(frames);
      }
    },
    [buffer.path, bridgeLayers, parseLayers, applyMultiEntries],
  );

  // Stable key so host inline arrays don't re-measure every render
  const peerAwarenessKey = useMemo(
    () =>
      (peerAwareness ?? [])
        .map(
          (p) =>
            `${p.sessionId}\t${p.path ?? ''}\t${p.selector ?? ''}\t${(p.selectors ?? []).join(',')}\t${p.colorHint ?? ''}`,
        )
        .join('|'),
    [peerAwareness],
  );

  // Measure peer awareness selectors in the preview iframe (HTML only).
  useEffect(() => {
    if (!htmlLike || !canvasOn) {
      setMeasuredPeerFrames((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const openPath = buffer.path ?? '';
    const peers = (peerAwareness ?? []).filter((p) => {
      if (!p.sessionId) return false;
      const pPath = (p.path ?? '').trim();
      // Match open file, or path-less peers (treat as current file)
      return !pPath || pPath === openPath;
    });
    if (peers.length === 0) {
      setMeasuredPeerFrames((prev) => (prev.length === 0 ? prev : []));
      peerMeasureMapRef.current = new Map();
      return;
    }
    const map = new Map<string, { colorHint: number; label?: string; selectors: string[] }>();
    const flat: string[] = [];
    const order: string[] = [];
    for (const p of peers) {
      const sels =
        p.selectors && p.selectors.length > 0
          ? p.selectors.filter((s): s is string => typeof s === 'string' && s.length > 0)
          : p.selector
            ? [p.selector]
            : [];
      if (sels.length === 0) continue;
      map.set(p.sessionId, {
        colorHint: typeof p.colorHint === 'number' ? p.colorHint : 220,
        label: p.displayName,
        selectors: sels,
      });
      order.push(p.sessionId);
      for (const s of sels) flat.push(s);
    }
    peerMeasureMapRef.current = map;
    if (flat.length === 0) {
      setMeasuredPeerFrames((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const iframe = iframeHostRef.current?.querySelector('iframe') as HTMLIFrameElement | null;
    if (!iframe) return;
    measureReqRef.current += 1;
    const requestId = `${measureReqRef.current}|${order.join('|')}`;
    // Defer until iframe can receive messages
    const t = window.setTimeout(() => {
      postToPreview(iframe, { type: 'neos.measure', selectors: flat, requestId });
    }, 80);
    return () => window.clearTimeout(t);
    // peerAwarenessKey stabilizes host-allocated arrays; peerAwareness still read for data
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key encodes awareness payload
  }, [peerAwarenessKey, buffer.path, htmlLike, canvasOn, reloadKey, previewHtml]);

  const peerCanvasFrames = useMemo(() => {
    // Explicit prop frames first; then measured (no sessionId on PeerCanvasFrame — just merge lists)
    const explicit = peerCanvasFramesProp ?? [];
    if (explicit.length === 0) return measuredPeerFrames;
    if (measuredPeerFrames.length === 0) return explicit;
    return [...explicit, ...measuredPeerFrames];
  }, [peerCanvasFramesProp, measuredPeerFrames]);

  const handleLayerSelect = (layer: LayerNode, opts?: { additive?: boolean }) => {
    if (!buffer.path) return;
    if (opts?.additive) {
      const current: MultiSelectEntry[] = [];
      for (const e of multiExtras) current.push(e);
      if (selection) {
        current.push({
          selection,
          detail: selectDetail,
        });
      }
      const next = toggleMultiSelectLayer(current, buffer.path, layer);
      applyMultiEntries(next);
      return;
    }
    clearMulti();
    const sel = selectionFromLayer(buffer.path, layer);
    // Explicit single — strip multi fields for collab
    setSelection(
      {
        filePath: sel.filePath,
        selector: sel.selector,
        layerId: sel.layerId,
      },
      {
        selector: layer.selector,
        tag: layer.tag,
      },
    );
    const iframe = iframeHostRef.current?.querySelector('iframe');
    if (iframe) {
      postToPreview(iframe as HTMLIFrameElement, {
        type: 'neos.scroll-to',
        selector: layer.selector,
      });
    }
  };

  const handleLayerHover = (layer: LayerNode | null) => {
    const iframe = iframeHostRef.current?.querySelector('iframe');
    if (!iframe) return;
    postToPreview(iframe as HTMLIFrameElement, {
      type: 'neos.highlight',
      selector: layer?.selector ?? null,
    });
  };

  const applyHtmlEdit = (next: string) => {
    if (next !== buffer.local) onEdit?.(next);
  };

  const pushCanvasUndo = (snapshot: string) => {
    const stack = canvasUndoRef.current;
    stack.push(snapshot);
    if (stack.length > CANVAS_UNDO_CAP) {
      stack.splice(0, stack.length - CANVAS_UNDO_CAP);
    }
    canvasRedoRef.current = [];
  };

  const undoCanvasTransform = useCallback(() => {
    const stack = canvasUndoRef.current;
    if (!stack.length) return;
    const prev = stack.pop()!;
    const current = bufferLocalRef.current;
    canvasRedoRef.current.push(current);
    if (canvasRedoRef.current.length > CANVAS_UNDO_CAP) {
      canvasRedoRef.current.splice(0, canvasRedoRef.current.length - CANVAS_UNDO_CAP);
    }
    if (prev !== current) {
      onEditRef.current?.(prev);
      setBridgeLayers(null);
      setReloadKey((k) => k + 1);
    }
  }, []);

  const redoCanvasTransform = useCallback(() => {
    const stack = canvasRedoRef.current;
    if (!stack.length) return;
    const next = stack.pop()!;
    const current = bufferLocalRef.current;
    canvasUndoRef.current.push(current);
    if (canvasUndoRef.current.length > CANVAS_UNDO_CAP) {
      canvasUndoRef.current.splice(0, canvasUndoRef.current.length - CANVAS_UNDO_CAP);
    }
    if (next !== current) {
      onEditRef.current?.(next);
      setBridgeLayers(null);
      setReloadKey((k) => k + 1);
    }
  }, []);

  // Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z redo for canvas transforms only (v0.8.5)
  useEffect(() => {
    if (!canvasOn) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (
        t
        && (t.tagName === 'TEXTAREA'
          || t.tagName === 'INPUT'
          || t.isContentEditable
          || t.closest?.('.cm-editor')
          || t.closest?.('[data-testid="code-editor"]'))
      ) {
        return;
      }
      e.preventDefault();
      if (e.shiftKey) redoCanvasTransform();
      else undoCanvasTransform();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canvasOn, undoCanvasTransform, redoCanvasTransform]);

  const handleToggleVisibility = (layer: LayerNode, visible: boolean) => {
    let next = toggleVisibilityByNeosId(buffer.local, layer.id, visible);
    if (next === buffer.local) {
      // Stamp stable data-neos-id then toggle (parse/bridge synthetic ids need attributes in source)
      const stamped = stampNeosIds(buffer.local);
      next = toggleVisibilityByNeosId(stamped, layer.id, visible);
      if (next === stamped) return;
    }
    applyHtmlEdit(next);
    setBridgeLayers(null);
    setReloadKey((k) => k + 1);
  };

  const handleToggleLock = (layer: LayerNode, locked: boolean) => {
    let next = toggleLockByNeosId(buffer.local, layer.id, locked);
    if (next === buffer.local) {
      const stamped = stampNeosIds(buffer.local);
      next = toggleLockByNeosId(stamped, layer.id, locked);
      if (next === stamped) return;
    }
    applyHtmlEdit(next);
    setBridgeLayers(null);
    setReloadKey((k) => k + 1);
  };

  const handleCopySelector = async (layer: LayerNode) => {
    try {
      await navigator.clipboard?.writeText(layer.selector);
    } catch {
      // ignore
    }
  };

  const handleEditWithAi = (layer: LayerNode) => {
    if (!buffer.path) return;
    clearMulti();
    const sel = selectionFromLayer(buffer.path, layer);
    setSelection(sel, { selector: layer.selector, tag: layer.tag });
    onEditWithAi?.(sel, { selector: layer.selector, tag: layer.tag });
  };

  const showPreview = mode === 'preview' || mode === 'split' || mode === 'inspect';
  const showCode = mode === 'code' || mode === 'split';

  /** Apply canvas HTML mutation; snapshot pre-transform for Cmd+Z undo. Returns whether applied. */
  const applyCanvasHtml = (mutate: (html: string) => string): boolean => {
    if (!buffer.path) return false;
    const snapshot = buffer.local;
    const layerId = selection?.layerId ?? null;
    let base = buffer.local;
    if (layerId && !base.includes(`data-neos-id="${layerId}"`)) {
      base = stampNeosIds(base);
    }
    const next = mutate(base);
    if (next === base || next === buffer.local) return false;
    pushCanvasUndo(snapshot);
    applyHtmlEdit(next);
    setBridgeLayers(null);
    setReloadKey((k) => k + 1);
    return true;
  };

  const multiEntriesForMove: MultiSelectEntry[] = (() => {
    const list: MultiSelectEntry[] = [...multiExtras];
    if (selection) {
      list.push({ selection, detail: selectDetail });
    }
    return list;
  })();

  const handleCanvasDragEnd = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    // Multi-move: apply same delta to every selected element (v0.7 M3)
    applyCanvasHtml((base) => {
      let html = base;
      for (const entry of multiEntriesForMove) {
        const layerId = entry.selection.layerId ?? null;
        const elId = elementIdFromSelector(entry.selection.selector);
        html = applyPositionDeltaToHtml(html, { neosId: layerId, elementId: elId, dx, dy });
      }
      return html;
    });
    // Nudge local bboxes so overlay tracks until iframe reload
    setSelectDetail((d) =>
      d?.bbox
        ? {
            ...d,
            bbox: {
              ...d.bbox,
              x: d.bbox.x + dx,
              y: d.bbox.y + dy,
            },
          }
        : d,
    );
    setMultiExtras((extras) =>
      extras.map((e) =>
        e.detail?.bbox
          ? {
              ...e,
              detail: {
                ...e.detail,
                bbox: {
                  ...e.detail.bbox,
                  x: e.detail.bbox.x + dx,
                  y: e.detail.bbox.y + dy,
                },
              },
            }
          : e,
      ),
    );
  };

  const handleCanvasTransformEnd = (t: CanvasTransformEnd) => {
    const layerId = selection?.layerId ?? null;
    const elId = elementIdFromSelector(selection?.selector);
    if (t.kind === 'move') {
      handleCanvasDragEnd(t.dx, t.dy);
      return;
    }

    // v0.8 M2: multi-select → group scale from primary SE handle
    // v0.8.5: Shift (t.uniform) → sx=sy
    const primaryBbox = selectDetail?.bbox;
    const groupMode = multiEntriesForMove.length > 1 && primaryBbox;

    if (groupMode && primaryBbox) {
      const { sx, sy, primaryNext } = computeGroupResizeScales(
        {
          x: primaryBbox.x,
          y: primaryBbox.y,
          width: primaryBbox.width,
          height: primaryBbox.height,
        },
        t.dw,
        t.dh,
        { uniform: Boolean(t.uniform) },
      );
      const anchor = { x: primaryBbox.x, y: primaryBbox.y };

      applyCanvasHtml((base) => {
        let html = base;
        // Stamp all target ids first when needed
        for (const entry of multiEntriesForMove) {
          const lid = entry.selection.layerId;
          if (lid && !html.includes(`data-neos-id="${lid}"`)) {
            html = stampNeosIds(html);
            break;
          }
        }
        for (const entry of multiEntriesForMove) {
          const from = entry.detail?.bbox;
          if (!from || from.width <= 0 || from.height <= 0) {
            // Fallback: size-only on primary if no bbox
            if (entry.selection.selector === selection?.selector) {
              html = applySizeDeltaToHtml(html, {
                neosId: entry.selection.layerId ?? null,
                elementId: elementIdFromSelector(entry.selection.selector),
                dw: t.dw,
                dh: t.dh,
                baseWidth: t.baseWidth,
                baseHeight: t.baseHeight,
              });
            }
            continue;
          }
          const to =
            entry.selection.selector === selection?.selector
              && entry.selection.layerId === selection?.layerId
              ? primaryNext
              : scaleBBoxFromAnchor(
                  { x: from.x, y: from.y, width: from.width, height: from.height },
                  anchor,
                  sx,
                  sy,
                );
          html = applyGroupResizeToHtml(html, {
            neosId: entry.selection.layerId ?? null,
            elementId: elementIdFromSelector(entry.selection.selector),
            from: { x: from.x, y: from.y, width: from.width, height: from.height },
            to,
          });
        }
        return html;
      });

      setSelectDetail((d) =>
        d?.bbox
          ? {
              ...d,
              bbox: {
                x: primaryNext.x,
                y: primaryNext.y,
                width: primaryNext.width,
                height: primaryNext.height,
              },
            }
          : d,
      );
      setMultiExtras((extras) =>
        extras.map((e) => {
          if (!e.detail?.bbox) return e;
          const from = e.detail.bbox;
          const to = scaleBBoxFromAnchor(
            { x: from.x, y: from.y, width: from.width, height: from.height },
            anchor,
            sx,
            sy,
          );
          return {
            ...e,
            detail: {
              ...e.detail,
              bbox: { x: to.x, y: to.y, width: to.width, height: to.height },
            },
          };
        }),
      );
      return;
    }

    // Single selection resize (primary only)
    applyCanvasHtml((base) =>
      applySizeDeltaToHtml(base, {
        neosId: layerId,
        elementId: elId,
        dw: t.dw,
        dh: t.dh,
        baseWidth: t.baseWidth,
        baseHeight: t.baseHeight,
      }),
    );
    setSelectDetail((d) =>
      d?.bbox
        ? {
            ...d,
            bbox: {
              ...d.bbox,
              width: Math.max(8, d.bbox.width + t.dw),
              height: Math.max(8, d.bbox.height + t.dh),
            },
          }
        : d,
    );
  };

  const canvasBoxes = (() => {
    if (!canvasOn) return bboxesFromMultiEntries([]);
    const entries: MultiSelectEntry[] = [...multiExtras];
    if (selection && selectDetail?.bbox) {
      entries.push({ selection, detail: selectDetail });
    }
    return bboxesFromMultiEntries(entries);
  })();
  const canvasBbox = canvasBoxes.primary;
  const canvasExtraBboxes = canvasBoxes.extras;
  const multiSelectCount = multiExtras.length + (selection?.selector ? 1 : 0);

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, height: '100%' }}
      data-testid="design-editor"
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid var(--border-primary, #333)',
        }}
      >
        <div style={{ display: 'flex', gap: 4 }}>
          {(['preview', 'code', 'split', 'inspect'] as DesignEditorMode[]).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`mode-${m}`}
              onClick={() => setMode(m)}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-primary, #333)',
                background: mode === m ? 'var(--bg-tertiary, #333)' : 'transparent',
                color: 'var(--text-primary, inherit)',
                cursor: 'pointer',
              }}
            >
              {m === 'preview'
                ? labels.preview
                : m === 'code'
                  ? labels.code
                  : m === 'split'
                    ? labels.split
                    : labels.inspect}
            </button>
          ))}
        </div>
        {showPreview && (
          <select
            aria-label="Device preset"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            style={{ fontSize: 12, marginLeft: 4 }}
          >
            {DEVICE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        {dirty && (
          <span data-testid="dirty-badge" style={{ fontSize: 11, color: '#fbbf24' }}>
            {labels.dirty}
          </span>
        )}
        {canvasOn && (
          <span
            data-testid="canvas-overlay-badge"
            title="Canvas overlay: select an element, then drag the frame"
            style={{ fontSize: 10, color: '#a5b4fc' }}
          >
            Canvas
          </span>
        )}
        {selection?.selector && (
          <span
            data-testid="selection-badge"
            title={
              multiSelectCount > 1
                ? `${multiSelectCount} selected · ${selection.selector}`
                : selection.selector
            }
            style={{
              fontSize: 10,
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--text-muted, #888)',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {multiSelectCount > 1
              ? `${multiSelectCount} selected`
              : `${labels.selection}: ${selection.selector}`}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {selection && onEditWithAi && (
            <button
              type="button"
              data-testid="edit-with-ai-button"
              onClick={() => onEditWithAi(selection, selectDetail)}
              style={{
                fontSize: 12,
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--border-primary, #333)',
                background: 'transparent',
                color: 'var(--text-primary, inherit)',
                cursor: 'pointer',
              }}
            >
              {labels.editWithAi}
            </button>
          )}
          <button
            type="button"
            data-testid="save-button"
            disabled={!dirty || saving || !buffer.path}
            onClick={handleSave}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 6,
              border: 0,
              background: 'var(--accent, #6366f1)',
              color: '#fff',
              opacity: !dirty || saving || !buffer.path ? 0.4 : 1,
              cursor: !dirty || saving || !buffer.path ? 'default' : 'pointer',
            }}
          >
            {labels.save}
          </button>
        </div>
      </div>

      {conflict && (
        <div
          data-testid="conflict-banner"
          role="alert"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
            padding: '8px 10px',
            background: 'rgba(127, 29, 29, 0.25)',
            borderBottom: '1px solid rgba(248, 113, 113, 0.4)',
            fontSize: 12,
            color: '#fecaca',
          }}
        >
          <span>{labels.conflictTitle}</span>
          <button type="button" onClick={() => onResolveConflict?.('keep-mine')}>
            {labels.keepMine}
          </button>
          <button type="button" onClick={() => onResolveConflict?.('take-agent')}>
            {labels.takeAgent}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowDiff((v) => !v);
              onResolveConflict?.('diff');
            }}
          >
            {showDiff ? labels.dismissDiff : labels.showDiff}
          </button>
        </div>
      )}

      {showDiff && diffPreview && (
        <pre
          data-testid="diff-preview"
          style={{
            margin: 0,
            maxHeight: 160,
            overflow: 'auto',
            fontSize: 11,
            padding: 8,
            background: 'var(--bg-secondary, #111)',
            color: 'var(--text-secondary, #ccc)',
            borderBottom: '1px solid var(--border-primary, #333)',
          }}
        >
          {diffPreview.preview.join('\n')}
        </pre>
      )}

      <div style={{ display: 'flex', minHeight: 0, flex: 1 }}>
        {showLayers && (
          <div style={{ width: 200, minWidth: 160, maxWidth: 280, minHeight: 0, display: 'flex' }}>
            <LayersPanel
              layers={layers}
              selectedLayerId={selection?.layerId}
              selectedSelector={selection?.selector}
              selectedLayerIds={multiExtras
                .map((e) => e.selection.layerId)
                .filter((id): id is string => Boolean(id))}
              selectedSelectors={multiExtras
                .map((e) => e.selection.selector)
                .filter((s): s is string => Boolean(s))}
              source={layerSource}
              onSelect={handleLayerSelect}
              onHover={handleLayerHover}
              onToggleVisibility={handleToggleVisibility}
              onToggleLock={handleToggleLock}
              onEditWithAi={onEditWithAi ? handleEditWithAi : undefined}
              onCopySelector={handleCopySelector}
              labels={{
                title: labels.layers,
                search: labels.layersSearch,
                empty: labels.layersEmpty,
                editWithAi: labels.editWithAi,
                copySelector: labels.copySelector,
              }}
            />
          </div>
        )}

        {showCode && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              width: showPreview ? '50%' : '100%',
              flex: showPreview ? undefined : 1,
              borderRight: showPreview ? '1px solid var(--border-primary, #333)' : undefined,
            }}
          >
            <div
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: 11,
                padding: '4px 10px',
                color: 'var(--text-muted, #888)',
                borderBottom: '1px solid var(--border-primary, #333)',
              }}
            >
              {buffer.path ?? '—'}
            </div>
            <CodeEditor
              value={buffer.local}
              filePath={buffer.path}
              onChange={onEdit}
              onSave={handleSave}
              aria-label={labels.code}
            />
          </div>
        )}

        {showPreview && (
          <div
            ref={iframeHostRef}
            style={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              width: showCode ? '50%' : '100%',
              flex: showCode ? undefined : 1,
              overflow: 'auto',
            }}
          >
            <div
              style={{
                fontSize: 11,
                padding: '4px 10px',
                color: 'var(--text-muted, #888)',
                borderBottom: '1px solid var(--border-primary, #333)',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span>
                {mode === 'inspect' ? labels.inspect : labels.preview}
                {dirty ? ` (${labels.dirty})` : ''}
              </span>
              {mode === 'inspect' && (
                <span style={{ fontSize: 10, color: '#a5b4fc' }}>
                  click to select · shift/ctrl/cmd+click multi
                </span>
              )}
              {canvasOn && multiSelectCount > 1 && (
                <span
                  data-testid="multi-select-badge"
                  style={{ fontSize: 10, color: '#c4b5fd' }}
                >
                  {multiSelectCount} multi
                </span>
              )}
            </div>
            <div
              style={{
                position: 'relative',
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
              data-testid="preview-canvas-host"
            >
              <PreviewFrame
                html={previewHtml}
                reloadKey={reloadKey}
                devicePresetId={deviceId}
                bridgeEnabled={htmlLike}
                inspectEnabled={inspectEnabled || canvasOn}
                onBridgeMessage={handleBridgeMessage}
              />
              <CanvasOverlay
                enabled={
                  canvasOn
                  && (Boolean(canvasBbox)
                    || (peerCanvasFrames?.some((p) => p.bboxes?.length) ?? false))
                }
                bbox={canvasBbox}
                extraBboxes={canvasExtraBboxes}
                peerFrames={peerCanvasFrames}
                onDragEnd={handleCanvasDragEnd}
                onTransformEnd={handleCanvasTransformEnd}
              />
            </div>
            {mode === 'inspect' && selection && (
              <div
                data-testid="inspect-panel"
                style={{
                  borderTop: '1px solid var(--border-primary, #333)',
                  padding: 8,
                  fontSize: 11,
                  background: 'var(--bg-secondary, #1a1a1a)',
                  color: 'var(--text-secondary, #ccc)',
                  maxHeight: 140,
                  overflow: 'auto',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{labels.selection}</div>
                <div style={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                  {selection.selector ?? '—'}
                </div>
                {selectDetail?.tag && (
                  <div style={{ marginTop: 4, color: 'var(--text-muted, #888)' }}>
                    tag: {selectDetail.tag}
                    {selectDetail.bbox
                      && ` · ${Math.round(selectDetail.bbox.width)}×${Math.round(selectDetail.bbox.height)}`}
                  </div>
                )}
                {selectDetail?.outerHTML && (
                  <pre
                    style={{
                      margin: '6px 0 0',
                      fontSize: 10,
                      whiteSpace: 'pre-wrap',
                      maxHeight: 60,
                      overflow: 'auto',
                      color: 'var(--text-muted, #aaa)',
                    }}
                  >
                    {selectDetail.outerHTML.slice(0, 500)}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export { editContextFromSelection };
