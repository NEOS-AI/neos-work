/**
 * Design Project workspace (web) — Files + Design Editor (Task 12 remainder).
 * Shares @neos-work/design-editor with desktop (Preview / Code / Layers / Inspect).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  createEmptyBuffer,
  DesignEditor,
  editContextFromSelection,
  isDirty,
  reduceEditorBuffer,
  type DesignEditorMode,
  type EditorBufferState,
} from '@neos-work/design-editor';
import type { SelectionState } from '@neos-work/shared';
import { loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';

export function ProjectDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );

  const [name, setName] = useState('');
  const [files, setFiles] = useState<Array<{ path: string }>>([]);
  const [buffer, setBuffer] = useState<EditorBufferState>(() => createEmptyBuffer());
  const [mode, setMode] = useState<DesignEditorMode>('split');
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

  const dirty = isDirty(buffer);

  const load = useCallback(async () => {
    if (!conn.token || !id) {
      nav('/');
      return;
    }
    setError(null);
    try {
      const p = await client.getProject(id);
      setName((p.data as { name?: string })?.name ?? id);
      const f = await client.listFiles(id);
      const list = ((f.data as Array<{ path: string; type?: string }>) ?? []).filter(
        (x) => x.type !== 'directory',
      );
      setFiles(list);
      const entry =
        list.find((x) => x.path === 'index.html')?.path
        || list.find((x) => /\.html?$/i.test(x.path))?.path
        || list[0]?.path
        || null;
      if (entry) {
        const file = await client.readFile(id, entry);
        const content = (file.data as { content?: string })?.content ?? '';
        const hash = (file.data as { hash?: string })?.hash ?? null;
        setBuffer(
          reduceEditorBuffer(createEmptyBuffer(), {
            type: 'open',
            path: entry,
            content,
            hash,
          }),
        );
      } else {
        setBuffer(createEmptyBuffer());
      }
      setSelection(null);
      setStatus(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }, [client, conn.token, id, nav]);

  useEffect(() => {
    void load();
  }, [load]);

  // Dirty close guard (web beforeunload)
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const openFile = async (path: string) => {
    if (!id) return;
    if (dirty && buffer.path && buffer.path !== path) {
      const ok = window.confirm('Discard unsaved changes?');
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const file = await client.readFile(id, path);
      const content = (file.data as { content?: string })?.content ?? '';
      const hash = (file.data as { hash?: string })?.hash ?? null;
      setBuffer(
        reduceEditorBuffer(createEmptyBuffer(), {
          type: 'open',
          path,
          content,
          hash,
        }),
      );
      setSelection(null);
      setStatus(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Read failed');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!id || !buffer.path) return;
    if (/\0/.test(buffer.local)) {
      setError('Content contains null bytes');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await client.writeFile(id, buffer.path, buffer.local);
      const hash =
        res.data && typeof res.data === 'object' && 'contentHash' in (res.data as object)
          ? String((res.data as { contentHash?: string }).contentHash ?? '')
          : null;
      setBuffer((prev) =>
        reduceEditorBuffer(prev, {
          type: 'saved',
          content: prev.local,
          hash: hash || undefined,
        }),
      );
      setStatus('Saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const runEditWithAi = async () => {
    if (!id || !aiPrompt.trim()) return;
    setAiBusy(true);
    setError(null);
    setStatus(null);
    try {
      const editContext =
        selection && buffer.path
          ? editContextFromSelection(selection, {
              snippet: undefined,
              mode: 'replace-selection',
            })
          : undefined;
      await client.createRun({
        projectId: id,
        prompt: aiPrompt.trim(),
        editContext,
      });
      setStatus('Run started — refresh file after agent completes');
      setAiPrompt('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Run failed');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="editor-layout" data-testid="project-workspace">
      <header className="editor-header row" style={{ justifyContent: 'space-between' }}>
        <div>
          <Link to="/projects" className="muted">
            ← Projects
          </Link>
          <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.15rem' }}>{name || id}</h1>
        </div>
        <div className="row muted" style={{ fontSize: 12 }}>
          {dirty && <span data-testid="web-dirty">Unsaved</span>}
          {status && <span>{status}</span>}
        </div>
      </header>

      {error && (
        <p className="err" role="alert" style={{ margin: '0 1rem' }}>
          {error}
        </p>
      )}

      <div className="editor-body">
        <aside className="editor-files card" data-testid="file-tree">
          <div className="muted" style={{ marginBottom: 8 }}>
            Files
          </div>
          <ul className="list">
            {files.map((f) => (
              <li key={f.path} style={{ padding: '0.35rem 0.5rem' }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: buffer.path === f.path ? 'var(--accent)' : 'var(--text)',
                    cursor: 'pointer',
                    padding: 0,
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onClick={() => void openFile(f.path)}
                  data-testid={`file-${f.path}`}
                >
                  <span className="mono">{f.path}</span>
                </button>
              </li>
            ))}
            {files.length === 0 && <li className="muted">No files</li>}
          </ul>
        </aside>

        <main className="editor-main" data-testid="design-editor-host">
          {buffer.path ? (
            <DesignEditor
              buffer={buffer}
              mode={mode}
              onModeChange={setMode}
              onEdit={(content) =>
                setBuffer((prev) => reduceEditorBuffer(prev, { type: 'edit', content }))
              }
              onSave={() => void save()}
              saving={busy}
              selection={selection}
              onSelectionChange={(sel) => setSelection(sel)}
              onEditWithAi={(sel) => {
                setSelection(sel);
                setAiPrompt((prev) =>
                  prev.trim()
                    ? prev
                    : sel.selector
                      ? `Update the element matching ${sel.selector}`
                      : 'Refine the selected element',
                );
              }}
              onResolveConflict={(choice, merged) =>
                setBuffer((prev) =>
                  reduceEditorBuffer(prev, { type: 'resolve-conflict', choice, merged }),
                )
              }
            />
          ) : (
            <div className="card muted" style={{ margin: '1rem' }}>
              Open a file to start the Design Editor (Preview · Code · Layers).
            </div>
          )}
        </main>

        <aside className="editor-ai card stack" data-testid="ai-panel">
          <div className="muted">Edit with AI</div>
          {selection?.selector && (
            <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
              {selection.selector}
            </div>
          )}
          <textarea
            className="input"
            style={{ minHeight: 100, resize: 'vertical' }}
            placeholder="Describe the change…"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            data-testid="ai-prompt"
          />
          <button
            type="button"
            className="btn"
            disabled={!aiPrompt.trim() || aiBusy}
            onClick={() => void runEditWithAi()}
            data-testid="ai-run"
          >
            {aiBusy ? '…' : 'Run'}
          </button>
          <p className="muted" style={{ fontSize: 11, margin: 0 }}>
            Uses replace-selection / patch by default. Full-file overwrite is not the default.
          </p>
        </aside>
      </div>
    </div>
  );
}
