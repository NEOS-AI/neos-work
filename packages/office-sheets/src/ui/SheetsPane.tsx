import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isConflict,
  isDirty,
  simpleDiffLines,
  type EditorBufferState,
} from '@neos-work/design-editor';
import { parseWorkbookSnapshot } from '../snapshot.js';
import { mountUniver, type MountUniverHandle } from './mount-univer.js';

export interface SheetsPaneLabels {
  save: string;
  dirty: string;
  conflictTitle: string;
  keepMine: string;
  takeAgent: string;
  showDiff: string;
  dismissDiff: string;
  parseFailed: string;
  loading: string;
}

export interface SheetsPaneProps {
  buffer: EditorBufferState;
  onEdit: (content: string) => void;
  onSave: () => void;
  saving?: boolean;
  locale?: string;
  formulaWorker?: boolean;
  labels: SheetsPaneLabels;
  onResolveConflict?: (
    choice: 'keep-mine' | 'take-agent' | 'diff',
    merged?: string,
  ) => void;
}

export function SheetsPane({
  buffer,
  onEdit,
  onSave,
  saving = false,
  locale,
  formulaWorker = false,
  labels,
  onResolveConflict,
}: SheetsPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef(buffer);
  bufferRef.current = buffer;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const handleRef = useRef<MountUniverHandle | null>(null);

  const dirty = isDirty(buffer);
  const conflict = isConflict(buffer);
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, snapshot: parseWorkbookSnapshot(buffer.local) };
    } catch {
      return { ok: false as const };
    }
  }, [buffer.local]);

  // Keep the last clean identity while dirty/conflict so the first onEdit
  // does not dispose + remount Univer (spec: remount on path or clean disk only).
  const cleanToken = `${buffer.local}::${buffer.diskHash ?? ''}`;
  const remountTokenRef = useRef(cleanToken);
  if (!dirty && !conflict) remountTokenRef.current = cleanToken;
  const remountToken = remountTokenRef.current;

  const [showDiff, setShowDiff] = useState(false);
  const [mounted, setMounted] = useState(false);

  const diffPreview = useMemo(() => {
    if (!buffer.pendingDisk) return null;
    return simpleDiffLines(buffer.local, buffer.pendingDisk);
  }, [buffer.local, buffer.pendingDisk]);

  useEffect(() => {
    if (!parsed.ok) {
      handleRef.current?.dispose();
      handleRef.current = null;
      setMounted(false);
      return;
    }
    const hostEl = hostRef.current;
    if (!hostEl) return;

    handleRef.current?.dispose();
    handleRef.current = mountUniver({
      hostEl,
      snapshot: parsed.snapshot,
      locale,
      formulaWorker,
      getDisk: () => bufferRef.current.disk,
      onEdit: (content) => onEditRef.current(content),
    });
    setMounted(true);
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
      setMounted(false);
    };
  }, [buffer.path, remountToken, parsed.ok, locale, formulaWorker]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== 's' && e.key !== 'S') return;
      const pane = paneRef.current;
      if (!pane || !document.activeElement || !pane.contains(document.activeElement)) return;
      const current = bufferRef.current;
      if (!isDirty(current) || !current.path) return;
      e.preventDefault();
      onSaveRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const saveDisabled = !dirty || saving || !buffer.path;

  return (
    <div
      ref={paneRef}
      className="sheets-pane"
      data-testid="sheets-pane"
      tabIndex={0}
      style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, height: '100%' }}
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
        {dirty && (
          <span data-testid="dirty-badge" style={{ fontSize: 11, color: '#fbbf24' }}>
            {labels.dirty}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            type="button"
            data-testid="save-button"
            disabled={saveDisabled}
            onClick={() => onSave()}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 6,
              border: 0,
              background: 'var(--accent, #6366f1)',
              color: '#fff',
              opacity: saveDisabled ? 0.4 : 1,
              cursor: saveDisabled ? 'default' : 'pointer',
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

      {!parsed.ok ? (
        <div
          data-testid="sheets-parse-failed"
          role="alert"
          style={{ padding: 16, fontSize: 13, color: 'var(--text-secondary, #ccc)' }}
        >
          {labels.parseFailed}
        </div>
      ) : (
        <div style={{ display: 'flex', minHeight: 0, flex: 1, position: 'relative' }}>
          {!mounted && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                color: 'var(--text-muted, #888)',
                pointerEvents: 'none',
              }}
            >
              {labels.loading}
            </div>
          )}
          <div ref={hostRef} style={{ flex: 1, minHeight: 0, minWidth: 0 }} />
        </div>
      )}
    </div>
  );
}
