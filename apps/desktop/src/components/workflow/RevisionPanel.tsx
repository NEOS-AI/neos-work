/**
 * RevisionPanel — slide-in panel showing workflow version history.
 * Allows users to view, label, and restore past snapshots.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowRevision } from '../../lib/engine.js';
import type { EngineClient } from '../../lib/engine.js';
import { safeEntityId, scrubDisplayText } from '../../lib/format-duration.js';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/format-relative-time.js';

interface RevisionPanelProps {
  workflowId: string;
  client: EngineClient;
  /** When true, restore requires an explicit confirm (plan Task 16 dirty warning). */
  isDirty?: boolean;
  onClose: () => void;
  onRestore: (snapshot: {
    nodes: unknown[];
    edges: unknown[];
    name?: string;
    description?: string;
    designSystemId?: string | null;
  }) => void;
}

export function RevisionPanel({ workflowId, client, isDirty, onClose, onRestore }: RevisionPanelProps) {
  const { t } = useTranslation('common');
  const [revisions, setRevisions] = useState<WorkflowRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [restoring, setRestoring] = useState<string | null>(null);
  /** When true, blur must not persist the in-progress label (Escape cancel). */
  const skipBlurSaveRef = useRef(false);

  const cancelLabelEdit = useCallback(() => {
    skipBlurSaveRef.current = true;
    setEditingId(null);
    setLabelInput('');
  }, []);

  const loadRevisions = async () => {
    setLoading(true);
    setLoadError(null);
    // Control-char / blank / overlong workflow ids never sent to list API
    const wfId = safeEntityId(workflowId);
    if (!wfId) {
      setRevisions([]);
      setLoadError('Workflow id contains invalid control characters');
      setLoading(false);
      return;
    }
    try {
      const res = await client.listRevisions(wfId);
      if (res.ok && res.data) {
        setRevisions(res.data);
      } else {
        setRevisions([]);
        setLoadError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Failed to load revisions',
        );
      }
    } catch (err) {
      setRevisions([]);
      const msg = err instanceof Error ? err.message : 'Failed to load revisions';
      setLoadError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to load revisions',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRevisions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId]);

  // Escape closes the history panel (plan Task 16 UX)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Cancel label edit first; do not close the panel or save via blur
      if (editingId) {
        e.preventDefault();
        cancelLabelEdit();
        return;
      }
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingId, onClose, cancelLabelEdit]);

  const handleRestore = async (rev: WorkflowRevision) => {
    // Control-char / blank / overlong ids never sent to restore API
    const wfId = safeEntityId(workflowId);
    const revEntityId = safeEntityId(rev.id);
    if (!wfId || !revEntityId) {
      window.alert('Revision id contains invalid control characters');
      return;
    }
    if (isDirty) {
      const ok = window.confirm(
        t(
          'workflow.restoreDirtyConfirm',
          'You have unsaved changes. Restoring will write this version to the server and replace the editor. Continue?',
        ),
      );
      if (!ok) return;
    } else {
      const ok = window.confirm(
        t(
          'workflow.restoreConfirm',
          'Restore this version to the server and load it into the editor? A pre-restore snapshot is kept.',
        ),
      );
      if (!ok) return;
    }
    setRestoring(rev.id);
    try {
      // Persist restore on the server first (creates pre-restore revision on the live record)
      const restored = await client.restoreRevision(wfId, revEntityId);
      if (restored.ok && restored.data && Array.isArray(restored.data.nodes) && Array.isArray(restored.data.edges)) {
        onRestore({
          nodes: restored.data.nodes,
          edges: restored.data.edges,
          name: restored.data.name,
          description: restored.data.description,
          designSystemId: restored.data.designSystemId,
        });
        onClose();
        return;
      }

      // Fallback: editor-only load from snapshot if server restore unavailable
      const full = await client.getRevision(wfId, revEntityId);
      if (!full.ok || !full.data?.snapshot) {
        const err =
          scrubDisplayText(
            (restored as { error?: string }).error
              || (full as { error?: string }).error,
            {
              collapseLines: true,
              maxChars: 300,
            },
          ) || 'Restore failed';
        window.alert(err);
        return;
      }
      try {
        const snap = JSON.parse(full.data.snapshot) as {
          nodes: unknown[];
          edges: unknown[];
          name?: string;
          description?: string;
          designSystemId?: string;
        };
        onRestore(snap);
        onClose();
      } catch {
        window.alert('Invalid snapshot');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Restore failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Restore failed',
      );
    } finally {
      setRestoring(null);
    }
  };

  const handleSaveLabel = async (revId: string) => {
    // Control-char labels rejected (check before trim; align with revisions API)
    if (/[\0\r\n]/.test(labelInput)) {
      setEditingId(null);
      window.alert('Label contains invalid control characters');
      return;
    }
    const next = labelInput.trim();
    if (!next || next.length > 200) {
      // Empty blur / Enter exits edit without writing
      setEditingId(null);
      return;
    }
    const wfId = safeEntityId(workflowId);
    const revEntityId = safeEntityId(revId);
    if (!wfId || !revEntityId) {
      setEditingId(null);
      window.alert('Revision id contains invalid control characters');
      return;
    }
    try {
      const res = await client.updateRevisionLabel(wfId, revEntityId, next);
      if (!res.ok) {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Update failed';
        window.alert(err);
        return;
      }
      setEditingId(null);
      void loadRevisions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Update failed',
      );
    }
  };

  const handleDelete = async (revId: string) => {
    // Control-char / blank / overlong ids never sent to delete API
    const wfId = safeEntityId(workflowId);
    const revEntityId = safeEntityId(revId);
    if (!wfId || !revEntityId) {
      window.alert('Revision id contains invalid control characters');
      return;
    }
    const ok = window.confirm(
      t('workflow.deleteRevisionConfirm', 'Delete this revision permanently? This cannot be undone.'),
    );
    if (!ok) return;
    try {
      const res = await client.deleteRevision(wfId, revEntityId);
      if (!res.ok) {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Delete failed';
        window.alert(err);
        return;
      }
      void loadRevisions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Delete failed',
      );
    }
  };

  return (
    <div className="fixed right-0 top-0 z-50 flex h-full w-80 flex-col border-l shadow-xl" style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border-primary)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('workflow.history', 'Version History')}
          {!loading && (
            <span className="ml-2 font-normal" style={{ color: 'var(--text-muted)' }}>
              ({revisions.length})
            </span>
          )}
        </span>
        <button
          onClick={onClose}
          className="text-lg leading-none"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && (
          <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
        )}
        {!loading && loadError && (
          <p className="text-center text-xs text-red-400">
            {scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 }) || loadError}
          </p>
        )}
        {!loading && !loadError && revisions.length === 0 && (
          <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('workflow.noRevisions', 'No saved versions yet.')}
          </p>
        )}
        {revisions.map((rev) => (
          <div
            key={rev.id}
            className="mb-2 rounded-lg border p-3 text-xs"
            style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}
          >
            {/* Label row */}
            <div className="flex items-center gap-1">
              {editingId === rev.id ? (
                <input
                  autoFocus
                  className="flex-1 rounded border px-1 py-0.5 text-xs"
                  style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                  value={labelInput}
                  maxLength={200}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleSaveLabel(rev.id);
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelLabelEdit();
                    }
                  }}
                  onBlur={() => {
                    if (skipBlurSaveRef.current) {
                      skipBlurSaveRef.current = false;
                      return;
                    }
                    void handleSaveLabel(rev.id);
                  }}
                />
              ) : (
                <span
                  className="flex-1 cursor-text font-medium"
                  style={{ color: 'var(--text-primary)' }}
                  onClick={() => {
                    // Clear any leftover Escape-cancel flag so the next blur can save
                    skipBlurSaveRef.current = false;
                    setEditingId(rev.id);
                    // Seed with scrubbed label so control chars never re-enter the input
                    setLabelInput(
                      scrubDisplayText(rev.label, { collapseLines: true, maxChars: 200 }),
                    );
                  }}
                  title="Click to add label"
                >
                  {rev.label
                    ? scrubDisplayText(rev.label, { collapseLines: true, maxChars: 200 }) || (
                        <span style={{ color: 'var(--text-muted)' }}>Auto-save</span>
                      )
                    : <span style={{ color: 'var(--text-muted)' }}>Auto-save</span>}
                </span>
              )}
            </div>

            {/* Timestamp + graph size (plan Task 16) */}
            <p className="mt-1" style={{ color: 'var(--text-muted)' }} title={formatAbsoluteTime(rev.createdAt)}>
              {formatRelativeTime(rev.createdAt)}
              {typeof rev.nodeCount === 'number' && (
                <span>
                  {' · '}
                  {rev.nodeCount} node{rev.nodeCount === 1 ? '' : 's'}
                  {typeof rev.edgeCount === 'number' ? ` · ${rev.edgeCount} edge${rev.edgeCount === 1 ? '' : 's'}` : ''}
                </span>
              )}
            </p>

            {/* Actions */}
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => void handleRestore(rev)}
                disabled={restoring === rev.id}
                className="rounded px-2 py-1 text-xs font-medium"
                style={{ backgroundColor: '#10b981', color: '#fff' }}
              >
                {restoring === rev.id ? '...' : t('workflow.restore', 'Restore')}
              </button>
              <button
                onClick={() => void handleDelete(rev.id)}
                className="rounded px-2 py-1 text-xs font-medium"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: '#ef4444' }}
              >
                {t('common.delete', 'Delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
