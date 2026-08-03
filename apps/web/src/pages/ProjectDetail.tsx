/**
 * Design Project workspace (web) — Files + Design Editor (Task 12 remainder).
 * Shares @neos-work/design-editor with desktop (Preview / Code / Layers / Inspect).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  createEmptyBuffer,
  DesignEditor,
  editContextFromSelection,
  isDirty,
  reduceEditorBuffer,
  shouldSkipDiskReload,
  type DesignEditorMode,
  type EditorBufferState,
} from '@neos-work/design-editor';
import type { SelectionState } from '@neos-work/shared';
import {
  PresencePeersBar,
  type PeerSelectionInfo,
  type PresencePeerInfo,
} from '@neos-work/ui-app';
import { loadConnection } from '../lib/auth.js';
import { ApiError, normalizeProjectRelPath, WebApiClient } from '../lib/api.js';

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
  /** Collab presence (v0.6 M1) — self + other peers. */
  const [collabSelf, setCollabSelf] = useState<PresencePeerInfo | null>(null);
  const [collabPeers, setCollabPeers] = useState<PresencePeerInfo[]>([]);
  const [collabSessionId, setCollabSessionId] = useState<string | null>(null);
  const collabSessionRef = useRef<string | null>(null);
  collabSessionRef.current = collabSessionId;
  /** path → lock holder (others only) — M3 advisory locks. */
  const [foreignLocks, setForeignLocks] = useState<
    Record<string, { sessionId: string; displayName: string }>
  >({});
  /** sessionId → peer selection (v0.7 M2). */
  const [peerSelections, setPeerSelections] = useState<Record<string, PeerSelectionInfo>>({});

  const dirty = isDirty(buffer);
  const bufferRef = useRef(buffer);
  bufferRef.current = buffer;

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

  // Collab presence + locks + selection (v0.6 M1/M3 + v0.7 M2)
  useEffect(() => {
    if (!conn.token || !id) return;
    setCollabSelf(null);
    setCollabPeers([]);
    setCollabSessionId(null);
    setForeignLocks({});
    setPeerSelections({});
    const stop = client.streamProjectCollab(
      id,
      (ev) => {
        if (ev.type === 'ready' && ev.sessionId) {
          setCollabSessionId(ev.sessionId);
        } else if (ev.type === 'presence.sync') {
          if (ev.self) {
            setCollabSelf(ev.self as PresencePeerInfo);
            if (ev.self.sessionId) setCollabSessionId(ev.self.sessionId);
          }
          setCollabPeers(Array.isArray(ev.peers) ? (ev.peers as PresencePeerInfo[]) : []);
          const selfId = ev.self?.sessionId ?? collabSessionRef.current;
          const next: Record<string, { sessionId: string; displayName: string }> = {};
          for (const l of ev.locks ?? []) {
            if (selfId && l.sessionId === selfId) continue;
            const lp = normalizeProjectRelPath(l.path);
            if (!lp) continue;
            next[lp] = { sessionId: l.sessionId, displayName: l.displayName };
          }
          setForeignLocks(next);
          const selMap: Record<string, PeerSelectionInfo> = {};
          for (const s of ev.selections ?? []) {
            if (selfId && s.sessionId === selfId) continue;
            if (s.path == null && s.selector == null) continue;
            const sp = s.path == null ? null : normalizeProjectRelPath(s.path) || null;
            selMap[s.sessionId] = { ...(s as PeerSelectionInfo), path: sp };
          }
          setPeerSelections(selMap);
        } else if (ev.type === 'presence.join' && ev.peer) {
          const peer = ev.peer as PresencePeerInfo;
          setCollabPeers((list) =>
            list.some((p) => p.sessionId === peer.sessionId) ? list : [...list, peer],
          );
        } else if (ev.type === 'presence.heartbeat' && ev.sessionId) {
          // Upsert unknown peers from heartbeat (multi-replica / late discovery)
          const sid = ev.sessionId;
          if (collabSessionRef.current && sid === collabSessionRef.current) return;
          setCollabPeers((list) => {
            if (list.some((p) => p.sessionId === sid)) return list;
            return [
              ...list,
              {
                sessionId: sid,
                displayName:
                  typeof ev.displayName === 'string' && ev.displayName.trim()
                    ? ev.displayName.trim()
                    : 'Anonymous',
                colorHint: typeof ev.colorHint === 'number' ? ev.colorHint : undefined,
              },
            ];
          });
        } else if (ev.type === 'presence.leave' && ev.sessionId) {
          const left = ev.sessionId;
          setCollabPeers((list) => list.filter((p) => p.sessionId !== left));
          setForeignLocks((m) => {
            const n: typeof m = {};
            for (const [path, h] of Object.entries(m)) {
              if (h.sessionId !== left) n[path] = h;
            }
            return n;
          });
          setPeerSelections((m) => {
            if (!(left in m)) return m;
            const n = { ...m };
            delete n[left];
            return n;
          });
        } else if (ev.type === 'lock.acquired' && ev.lock) {
          const lock = ev.lock;
          const lp = normalizeProjectRelPath(lock.path);
          if (!lp) return;
          setForeignLocks((m) => {
            if (collabSessionRef.current && lock.sessionId === collabSessionRef.current) return m;
            return {
              ...m,
              [lp]: { sessionId: lock.sessionId, displayName: lock.displayName },
            };
          });
        } else if (ev.type === 'lock.released' && ev.path) {
          const lp = normalizeProjectRelPath(ev.path);
          if (!lp) return;
          setForeignLocks((m) => {
            const n = { ...m };
            delete n[lp];
            return n;
          });
        } else if (ev.type === 'selection.changed' && ev.selection) {
          const sel = ev.selection as PeerSelectionInfo;
          if (collabSessionRef.current && sel.sessionId === collabSessionRef.current) return;
          const sp = sel.path == null ? null : normalizeProjectRelPath(sel.path) || null;
          setPeerSelections((m) => {
            if (sp == null && sel.selector == null) {
              if (!(sel.sessionId in m)) return m;
              const n = { ...m };
              delete n[sel.sessionId];
              return n;
            }
            return { ...m, [sel.sessionId]: { ...sel, path: sp } };
          });
        }
      },
      { displayName: 'Web' },
    );
    return () => stop();
  }, [client, conn.token, id]);

  // Multi-replica resilience: REST peers snapshot + heartbeat if SSE join/heartbeat was missed
  useEffect(() => {
    if (!conn.token || !id || !collabSessionId) return;
    const sessionId = collabSessionId;
    const tick = () => {
      void client.postCollabHeartbeat(id, { sessionId }).catch(() => {});
      void client
        .getCollabPeers(id)
        .then((res) => {
          if (!res.ok || !res.data?.peers || !Array.isArray(res.data.peers)) return;
          const selfId = collabSessionRef.current;
          const next = res.data.peers
            .filter(
              (p): p is PresencePeerInfo =>
                !!p
                && typeof p.sessionId === 'string'
                && p.sessionId.length > 0
                && p.sessionId !== selfId
                && typeof p.displayName === 'string',
            )
            .map((p) => ({
              sessionId: p.sessionId,
              displayName: p.displayName,
              colorHint: typeof p.colorHint === 'number' ? p.colorHint : undefined,
              joinedAt: typeof p.joinedAt === 'string' ? p.joinedAt : undefined,
              lastSeen: typeof p.lastSeen === 'string' ? p.lastSeen : undefined,
            }));
          setCollabPeers(next);
        })
        .catch(() => {});
    };
    // Delay first poll so presence.sync wins the initial list; then refresh periodically
    const first = window.setTimeout(tick, 12_000);
    const iv = window.setInterval(tick, 45_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(iv);
    };
  }, [client, conn.token, id, collabSessionId]);

  // M3: try to acquire lock when opening a file; release previous
  const bufferPathNorm = buffer.path ? normalizeProjectRelPath(buffer.path) : '';
  const lockedByOther =
    bufferPathNorm && foreignLocks[bufferPathNorm]
      ? foreignLocks[bufferPathNorm]!.displayName
      : null;

  useEffect(() => {
    if (!conn.token || !id || !collabSessionId || !buffer.path) return;
    const path = normalizeProjectRelPath(buffer.path);
    if (!path) return;
    void client
      .collabLock(id, {
        sessionId: collabSessionId,
        path,
        action: 'acquire',
      })
      .then((res) => {
        if (!res.ok && res.data && typeof res.data === 'object' && 'holder' in (res.data as object)) {
          const holder = (res.data as { holder?: { sessionId?: string; displayName?: string } })
            .holder;
          if (holder?.displayName && holder.sessionId) {
            setForeignLocks((m) => ({
              ...m,
              [path]: { sessionId: holder.sessionId!, displayName: holder.displayName! },
            }));
          }
        }
      })
      .catch(() => {
        // network — leave lock state to SSE
      });
    return () => {
      void client
        .collabLock(id, {
          sessionId: collabSessionId,
          path,
          action: 'release',
        })
        .catch(() => {});
    };
  }, [client, conn.token, id, collabSessionId, buffer.path]);

  // M2/M3: publish local selection (+ multi selectors) for peer indicators
  const multiSelectorsKey = (selection?.multiSelectors ?? []).join('\0');
  const multiLayerIdsKey = (selection?.multiLayerIds ?? []).join('\0');
  useEffect(() => {
    if (!conn.token || !id || !collabSessionId) return;
    const rawPath = selection?.filePath ?? buffer.path ?? null;
    const path =
      rawPath == null ? null : normalizeProjectRelPath(rawPath) || null;
    const selector = selection?.selector ?? null;
    const layerId = selection?.layerId ?? null;
    const selectors = selection?.multiSelectors;
    const layerIds = selection?.multiLayerIds;
    const t = window.setTimeout(() => {
      void client
        .collabSelection(id, {
          sessionId: collabSessionId,
          path,
          selector,
          layerId,
          selectors: selectors && selectors.length > 1 ? selectors : null,
          layerIds: layerIds && layerIds.length > 1 ? layerIds : null,
        })
        .catch(() => {});
    }, 120);
    return () => window.clearTimeout(t);
  }, [
    client,
    conn.token,
    id,
    collabSessionId,
    selection?.filePath,
    selection?.selector,
    selection?.layerId,
    multiSelectorsKey,
    multiLayerIdsKey,
    buffer.path,
  ]);

  // Project file SSE — reload open buffer on agent/remote writes (disk-changed / conflict)
  // Skip re-fetch when event hash matches known disk/pending tip (hash-aware, v0.5.30).
  useEffect(() => {
    if (!conn.token || !id) return;
    const stop = client.streamProjectFileEvents(id, (ev) => {
      if (ev.type !== 'file.changed' && ev.type !== 'file.created') return;
      const p = normalizeProjectRelPath(ev.path);
      if (!p) return;
      void (async () => {
        try {
          const cur = bufferRef.current;
          const curPath = cur.path ? normalizeProjectRelPath(cur.path) : '';
          if (!curPath || curPath !== p) return;
          if (shouldSkipDiskReload(cur, { path: p, hash: ev.hash ?? null })) return;

          const file = await client.readFile(id, p);
          const content = (file.data as { content?: string })?.content ?? '';
          const hash = (file.data as { hash?: string })?.hash ?? null;
          setBuffer((prev) => {
            const prevPath = prev.path ? normalizeProjectRelPath(prev.path) : '';
            if (!prevPath || prevPath !== p) return prev;
            if (shouldSkipDiskReload(prev, { path: p, hash: hash ?? ev.hash ?? null })) {
              return prev;
            }
            return reduceEditorBuffer(prev, {
              type: 'disk-changed',
              content,
              hash,
            });
          });
          setStatus((s) => s ?? 'File updated on disk');
        } catch {
          // best-effort
        }
      })();
    });
    return () => stop();
  }, [client, conn.token, id]);

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
      if (res.ok) {
        const data = res.data as { hash?: string; contentHash?: string } | undefined;
        const hash =
          typeof data?.hash === 'string' && data.hash
            ? data.hash
            : typeof data?.contentHash === 'string'
              ? data.contentHash
              : null;
        setBuffer((prev) =>
          reduceEditorBuffer(prev, {
            type: 'saved',
            content: prev.local,
            hash: hash || undefined,
          }),
        );
        setStatus('Saved');
      } else {
        let msg =
          typeof res.error === 'string' && res.error ? res.error : 'Save failed';
        const holder =
          res.data && typeof res.data === 'object' && res.data !== null && 'holder' in res.data
            ? (res.data as { holder?: { displayName?: string } }).holder
            : undefined;
        if (holder && typeof holder.displayName === 'string' && holder.displayName.trim()) {
          msg = `Locked by ${holder.displayName.trim()}`;
        }
        setError(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 300));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const reloadOpenFileFromDisk = async () => {
    if (!id || !buffer.path) return;
    try {
      const file = await client.readFile(id, buffer.path);
      const content = (file.data as { content?: string })?.content ?? '';
      const hash = (file.data as { hash?: string })?.hash ?? null;
      setBuffer((prev) =>
        reduceEditorBuffer(prev, {
          type: 'disk-changed',
          content,
          hash,
        }),
      );
    } catch {
      // best-effort; leave buffer as-is
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
      const res = await client.createRun({
        projectId: id,
        prompt: aiPrompt.trim(),
        editContext,
      });
      const runId =
        res.data && typeof res.data === 'object' && typeof (res.data as { id?: string }).id === 'string'
          ? (res.data as { id: string }).id
          : '';
      setAiPrompt('');
      if (!runId) {
        setStatus('Run started');
        return;
      }
      setStatus(`Run ${runId.slice(0, 8)}…`);
      // Prefer project file SSE for disk-changed; still poll run status for UX.
      // Fallback reload when run ends (covers agents that write without SSE gap).
      const terminal = new Set(['succeeded', 'failed', 'canceled', 'cancelled', 'error']);
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const st = await client.getRun(runId);
          const status =
            st.data && typeof st.data === 'object'
              ? String((st.data as { status?: string }).status ?? '')
              : '';
          if (terminal.has(status.toLowerCase())) {
            setStatus(status === 'succeeded' ? 'Run finished' : `Run ${status}`);
            if (status.toLowerCase() === 'succeeded') {
              await reloadOpenFileFromDisk();
            }
            return;
          }
        } catch {
          break;
        }
      }
      setStatus('Run still running — file SSE will refresh when disk changes');
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
          <PresencePeersBar peers={collabPeers} self={collabSelf} selections={peerSelections} />
          {lockedByOther && (
            <span
              data-testid="file-lock-banner"
              className="err"
              title="Advisory lock (hard-enforced when NEOS_SHARED_EDIT=1)"
            >
              Locked by {lockedByOther}
            </span>
          )}
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
              peerAwareness={Object.entries(peerSelections).map(([sessionId, sel]) => {
                const selPath =
                  sel?.path == null ? null : normalizeProjectRelPath(sel.path) || null;
                const openPath = buffer.path ? normalizeProjectRelPath(buffer.path) : '';
                // Only surface peer selection when on the same normalized file path
                if (selPath && openPath && selPath !== openPath) {
                  return {
                    sessionId,
                    colorHint: sel?.colorHint,
                    displayName: sel?.displayName,
                    path: selPath,
                    selector: null as string | null,
                    selectors: undefined as string[] | undefined,
                  };
                }
                return {
                  sessionId,
                  colorHint: sel?.colorHint,
                  displayName: sel?.displayName,
                  path: selPath,
                  selector: sel?.selector ?? null,
                  selectors: sel?.selectors,
                };
              })}
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
