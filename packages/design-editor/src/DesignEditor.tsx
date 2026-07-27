/**
 * Design Editor chrome: mode tabs + Code + Preview (+ Split).
 * Host supplies buffer state and save; package owns panes (Q9 CodeMirror).
 */

import { useMemo, useState } from 'react';
import { CodeEditor } from './CodeEditor.js';
import { DEVICE_PRESETS } from './device-presets.js';
import { PreviewFrame, toPreviewDocument } from './PreviewFrame.js';
import { isConflict, isDirty, simpleDiffLines, type EditorBufferState } from './dirty-state.js';

export type DesignEditorMode = 'preview' | 'code' | 'split';

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
    save?: string;
    dirty?: string;
    conflictTitle?: string;
    keepMine?: string;
    takeAgent?: string;
    showDiff?: string;
    dismissDiff?: string;
  };
  onResolveConflict?: (choice: 'keep-mine' | 'take-agent' | 'diff', merged?: string) => void;
  className?: string;
}

const defaultLabels = {
  preview: 'Preview',
  code: 'Code',
  split: 'Split',
  save: 'Save',
  dirty: 'Unsaved',
  conflictTitle: 'Disk changed while editing',
  keepMine: 'Keep mine',
  takeAgent: 'Take agent',
  showDiff: 'Diff',
  dismissDiff: 'Close diff',
};

export function DesignEditor({
  buffer,
  mode: controlledMode,
  onModeChange,
  onEdit,
  onSave,
  saving = false,
  labels: labelsProp,
  onResolveConflict,
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

  const dirty = isDirty(buffer);
  const conflict = isConflict(buffer);

  const previewHtml = useMemo(
    () => toPreviewDocument(buffer.local, buffer.path),
    [buffer.local, buffer.path],
  );

  const diffPreview = useMemo(() => {
    if (!buffer.pendingDisk) return null;
    return simpleDiffLines(buffer.local, buffer.pendingDisk);
  }, [buffer.local, buffer.pendingDisk]);

  const handleSave = () => {
    onSave?.();
    setReloadKey((k) => k + 1);
  };

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
          {(['preview', 'code', 'split'] as DesignEditorMode[]).map((m) => (
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
              {m === 'preview' ? labels.preview : m === 'code' ? labels.code : labels.split}
            </button>
          ))}
        </div>
        {(mode === 'preview' || mode === 'split') && (
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
        <div style={{ marginLeft: 'auto' }}>
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
        {(mode === 'code' || mode === 'split') && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              width: mode === 'split' ? '50%' : '100%',
              borderRight: mode === 'split' ? '1px solid var(--border-primary, #333)' : undefined,
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
        {(mode === 'preview' || mode === 'split') && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              width: mode === 'split' ? '50%' : '100%',
              overflow: 'auto',
            }}
          >
            <div
              style={{
                fontSize: 11,
                padding: '4px 10px',
                color: 'var(--text-muted, #888)',
                borderBottom: '1px solid var(--border-primary, #333)',
              }}
            >
              {labels.preview}
              {dirty ? ` (${labels.dirty})` : ''}
            </div>
            <PreviewFrame
              html={previewHtml}
              reloadKey={reloadKey}
              devicePresetId={deviceId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
