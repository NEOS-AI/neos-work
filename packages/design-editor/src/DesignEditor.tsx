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
import {
  editContextFromSelection,
  selectionFromBridge,
  selectionFromLayer,
} from './selection-state.js';
import type { BridgeInboundMessage, BridgeSelectPayload } from './bridge-types.js';

export type DesignEditorMode = 'preview' | 'code' | 'split' | 'inspect';

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
  className?: string;
}

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
  const iframeHostRef = useRef<HTMLDivElement>(null);

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

  const dirty = isDirty(buffer);
  const conflict = isConflict(buffer);
  const htmlLike = isHtmlPath(buffer.path);
  const showLayers = showLayersProp ?? htmlLike;

  const previewHtml = useMemo(() => {
    const base = toPreviewDocument(buffer.local, buffer.path);
    // Stamp ids so visibility/lock rewrites can target buffer HTML
    return htmlLike ? stampNeosIds(base) : base;
  }, [buffer.local, buffer.path, htmlLike]);

  const parseLayers = useMemo(
    () => (htmlLike ? parseHtmlToLayerTree(previewHtml) : []),
    [previewHtml, htmlLike],
  );

  const layers = bridgeLayers ?? parseLayers;
  const layerSource = bridgeLayers ? 'bridge' : 'parse';

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
        const layer = findLayerBySelector(bridgeLayers ?? parseLayers, payload.selector);
        const sel = selectionFromBridge(buffer.path, payload, layer?.id);
        setSelection(sel, payload);
        // Outline already set inside iframe; also ask highlight for consistency
        const iframe = iframeHostRef.current?.querySelector('iframe');
        if (iframe) {
          postToPreview(iframe as HTMLIFrameElement, {
            type: 'neos.highlight',
            selector: payload.selector,
          });
        }
      }
    },
    [buffer.path, bridgeLayers, parseLayers, setSelection],
  );

  const handleLayerSelect = (layer: LayerNode) => {
    if (!buffer.path) return;
    const sel = selectionFromLayer(buffer.path, layer);
    setSelection(sel, {
      selector: layer.selector,
      tag: layer.tag,
    });
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
    const sel = selectionFromLayer(buffer.path, layer);
    setSelection(sel, { selector: layer.selector, tag: layer.tag });
    onEditWithAi?.(sel, { selector: layer.selector, tag: layer.tag });
  };

  const showPreview = mode === 'preview' || mode === 'split' || mode === 'inspect';
  const showCode = mode === 'code' || mode === 'split';

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
        {selection?.selector && (
          <span
            data-testid="selection-badge"
            title={selection.selector}
            style={{
              fontSize: 10,
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--text-muted, #888)',
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            {labels.selection}: {selection.selector}
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
                <span style={{ fontSize: 10, color: '#a5b4fc' }}>click to select</span>
              )}
            </div>
            <PreviewFrame
              html={previewHtml}
              reloadKey={reloadKey}
              devicePresetId={deviceId}
              bridgeEnabled={htmlLike}
              inspectEnabled={inspectEnabled}
              onBridgeMessage={handleBridgeMessage}
            />
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
