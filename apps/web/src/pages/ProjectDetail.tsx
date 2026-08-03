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
  formatPresenceLeaveMessage,
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
  /** File revisions (list / view / restore). */
  const [revisions, setRevisions] = useState<
    Array<{
      id: string;
      projectId?: string;
      path: string;
      contentHash: string;
      source: string;
      createdAt: string;
    }>
  >([]);
  const [revisionPreview, setRevisionPreview] = useState<{
    id: string;
    contentHash: string;
    source: string;
    content?: string;
  } | null>(null);
  const [revisionBusy, setRevisionBusy] = useState(false);
  /** Project agent runs (list / events / cancel). */
  type RunListItem = {
    id: string;
    status: string;
    agentId?: string | null;
    projectId?: string | null;
    prompt?: string;
    error?: string | null;
    createdAt?: string;
    eventCount?: number;
  };
  type RunEventItem = {
    id: string;
    type: string;
    ts: string;
    data?: unknown;
  };
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runEvents, setRunEvents] = useState<RunEventItem[]>([]);
  const [runsBusy, setRunsBusy] = useState(false);
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
          setCollabPeers((list) => {
            const gone = list.find((p) => p.sessionId === left);
            if (gone) {
              setStatus(
                formatPresenceLeaveMessage(
                  gone.displayName,
                  typeof ev.reason === 'string' ? ev.reason : undefined,
                ),
              );
            }
            return list.filter((p) => p.sessionId !== left);
          });
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

  // Multi-replica resilience: REST peers/locks/selections + heartbeat if SSE was missed
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
      void client
        .getCollabLocks(id)
        .then((res) => {
          if (!res.ok || !res.data?.locks || !Array.isArray(res.data.locks)) return;
          const selfId = collabSessionRef.current;
          const next: Record<string, { sessionId: string; displayName: string }> = {};
          for (const l of res.data.locks) {
            if (!l || typeof l.sessionId !== 'string' || typeof l.path !== 'string') continue;
            if (selfId && l.sessionId === selfId) continue;
            const lp = normalizeProjectRelPath(l.path);
            if (!lp) continue;
            next[lp] = {
              sessionId: l.sessionId,
              displayName:
                typeof l.displayName === 'string' && l.displayName.trim()
                  ? l.displayName.trim()
                  : 'Anonymous',
            };
          }
          setForeignLocks(next);
        })
        .catch(() => {});
      void client
        .getCollabSelections(id)
        .then((res) => {
          if (!res.ok || !res.data?.selections || !Array.isArray(res.data.selections)) return;
          const selfId = collabSessionRef.current;
          const selMap: Record<string, PeerSelectionInfo> = {};
          for (const s of res.data.selections) {
            if (!s || typeof s.sessionId !== 'string' || !s.sessionId) continue;
            if (selfId && s.sessionId === selfId) continue;
            if (s.path == null && s.selector == null) continue;
            const sp = s.path == null ? null : normalizeProjectRelPath(s.path) || null;
            selMap[s.sessionId] = { ...(s as PeerSelectionInfo), path: sp };
          }
          setPeerSelections(selMap);
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

  const loadRevisions = useCallback(async () => {
    if (!id || !buffer.path) {
      setRevisions([]);
      setRevisionPreview(null);
      return;
    }
    try {
      const res = await client.listRevisions(id, buffer.path);
      if (res.ok && Array.isArray(res.data)) {
        setRevisions(res.data);
      } else {
        setRevisions([]);
      }
      setRevisionPreview(null);
    } catch (err) {
      setRevisions([]);
      setRevisionPreview(null);
      setError(err instanceof ApiError ? err.message : 'Failed to load revisions');
    }
  }, [client, id, buffer.path]);

  useEffect(() => {
    void loadRevisions();
  }, [loadRevisions]);

  const viewRevision = async (revisionId: string) => {
    if (!id || revisionBusy) return;
    setRevisionBusy(true);
    setError(null);
    try {
      const res = await client.getRevision(id, revisionId);
      if (!res.ok || !res.data) {
        setError(
          (typeof res.error === 'string' && res.error ? res.error : 'Failed to load revision').replace(
            /[\0\r\n]+/g,
            ' ',
          ).slice(0, 300),
        );
        setRevisionPreview(null);
        return;
      }
      setRevisionPreview({
        id: res.data.id,
        contentHash: res.data.contentHash,
        source: res.data.source,
        content: res.data.content,
      });
    } catch (err) {
      setRevisionPreview(null);
      setError(err instanceof ApiError ? err.message : 'Failed to load revision');
    } finally {
      setRevisionBusy(false);
    }
  };

  const restoreRevision = async (revisionId: string) => {
    if (!id || revisionBusy) return;
    if (dirty) {
      const ok = window.confirm('Discard unsaved changes and restore this revision?');
      if (!ok) return;
    }
    setRevisionBusy(true);
    setError(null);
    try {
      const res = await client.restoreRevision(id, revisionId);
      if (!res.ok) {
        setError(
          (typeof res.error === 'string' && res.error ? res.error : 'Restore failed')
            .replace(/[\0\r\n]+/g, ' ')
            .slice(0, 300),
        );
        return;
      }
      const path =
        (typeof res.data?.path === 'string' && res.data.path) || buffer.path || null;
      const restoreHash =
        typeof res.data?.hash === 'string' && res.data.hash ? res.data.hash : null;
      if (path) {
        const file = await client.readFile(id, path);
        const content = (file.data as { content?: string })?.content ?? '';
        const hash =
          (file.data as { hash?: string })?.hash
          ?? restoreHash
          ?? null;
        setBuffer(
          reduceEditorBuffer(createEmptyBuffer(), {
            type: 'open',
            path,
            content,
            hash,
          }),
        );
        setSelection(null);
      }
      setStatus('Restored');
      await loadRevisions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Restore failed');
    } finally {
      setRevisionBusy(false);
    }
  };

  const TERMINAL_RUN_STATUSES = useMemo(
    () => new Set(['succeeded', 'failed', 'canceled', 'cancelled', 'error']),
    [],
  );

  const isRunTerminal = useCallback(
    (status: string) => TERMINAL_RUN_STATUSES.has(status.toLowerCase()),
    [TERMINAL_RUN_STATUSES],
  );

  const loadRuns = useCallback(async () => {
    if (!id) {
      setRuns([]);
      return;
    }
    try {
      const res = await client.listRuns(id);
      if (res.ok && Array.isArray(res.data)) {
        setRuns(res.data);
      } else {
        setRuns([]);
      }
    } catch {
      setRuns([]);
    }
  }, [client, id]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const selectRun = async (runId: string) => {
    if (!id || runsBusy) return;
    if (selectedRunId === runId) {
      setSelectedRunId(null);
      setRunEvents([]);
      return;
    }
    setRunsBusy(true);
    setError(null);
    setSelectedRunId(runId);
    try {
      const res = await client.listRunEvents(runId);
      if (res.ok && Array.isArray(res.data)) {
        setRunEvents(res.data.slice(-20));
      } else {
        setRunEvents([]);
      }
    } catch (err) {
      setRunEvents([]);
      setError(err instanceof ApiError ? err.message : 'Failed to load run events');
    } finally {
      setRunsBusy(false);
    }
  };

  const cancelRun = async (runId: string) => {
    if (!id || runsBusy) return;
    setRunsBusy(true);
    setError(null);
    try {
      const res = await client.cancelRun(runId);
      if (!res.ok) {
        setError(
          (typeof res.error === 'string' && res.error ? res.error : 'Cancel failed')
            .replace(/[\0\r\n]+/g, ' ')
            .slice(0, 300),
        );
      } else {
        setStatus('Run canceled');
      }
      await loadRuns();
      if (selectedRunId === runId) {
        try {
          const ev = await client.listRunEvents(runId);
          if (ev.ok && Array.isArray(ev.data)) {
            setRunEvents(ev.data.slice(-20));
          }
        } catch {
          // best-effort
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cancel failed');
    } finally {
      setRunsBusy(false);
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
        void loadRevisions();
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
      if (!res.ok) {
        const msg =
          typeof res.error === 'string' && res.error ? res.error : 'Run failed';
        setError(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 300));
        return;
      }
      const runId =
        res.data && typeof res.data === 'object' && typeof (res.data as { id?: string }).id === 'string'
          ? (res.data as { id: string }).id
          : '';
      setAiPrompt('');
      if (!runId) {
        setStatus('Run started');
        void loadRuns();
        return;
      }
      setStatus(`Run ${runId.slice(0, 8)}…`);
      void loadRuns();
      // Prefer project file SSE for disk-changed; still poll run status for UX.
      // Fallback reload when run ends (covers agents that write without SSE gap).
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const st = await client.getRun(runId);
          const status =
            st.data && typeof st.data === 'object'
              ? String((st.data as { status?: string }).status ?? '')
              : '';
          if (isRunTerminal(status)) {
            setStatus(status === 'succeeded' ? 'Run finished' : `Run ${status}`);
            if (status.toLowerCase() === 'succeeded') {
              await reloadOpenFileFromDisk();
            }
            void loadRuns();
            return;
          }
        } catch {
          break;
        }
      }
      setStatus('Run still running — file SSE will refresh when disk changes');
      void loadRuns();
    } catch (err) {
      // Network / abort only — createRun uses requestEnvelope (no throw on HTTP).
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

          <div
            data-testid="web-revisions"
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--border, #333)',
            }}
          >
            <div className="muted" style={{ marginBottom: 8 }}>
              Revisions
              {buffer.path ? (
                <span className="mono" style={{ marginLeft: 6, fontSize: 11 }}>
                  {buffer.path}
                </span>
              ) : null}
            </div>
            {!buffer.path ? (
              <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                Open a file to see revisions.
              </p>
            ) : revisions.length === 0 ? (
              <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                No revisions yet.
              </p>
            ) : (
              <ul className="list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {revisions.map((r) => (
                  <li
                    key={r.id}
                    data-testid={`web-revision-${r.id}`}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 6,
                      padding: '0.35rem 0',
                      borderBottom: '1px solid var(--border, #2a2a2a)',
                      fontSize: 11,
                    }}
                  >
                    <div style={{ flex: '1 1 100%', minWidth: 0 }}>
                      <div className="mono muted">
                        {r.source} · {(r.contentHash || '').slice(0, 8)}
                      </div>
                      <div className="muted" style={{ fontSize: 10 }}>
                        {r.createdAt}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 11, padding: '0.2rem 0.45rem' }}
                      disabled={revisionBusy}
                      data-testid={`web-revision-view-${r.id}`}
                      onClick={() => void viewRevision(r.id)}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ fontSize: 11, padding: '0.2rem 0.45rem' }}
                      disabled={revisionBusy}
                      data-testid={`web-revision-restore-${r.id}`}
                      onClick={() => void restoreRevision(r.id)}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {revisionPreview && (
              <div
                data-testid="web-revision-preview"
                style={{
                  marginTop: 8,
                  maxHeight: 160,
                  overflow: 'auto',
                  border: '1px solid var(--border, #333)',
                  borderRadius: 4,
                  padding: 8,
                }}
              >
                <div
                  className="row"
                  style={{ justifyContent: 'space-between', marginBottom: 4, fontSize: 10 }}
                >
                  <span className="mono muted">
                    {revisionPreview.source} · {(revisionPreview.contentHash || '').slice(0, 8)}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 10, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted, #888)' }}
                    onClick={() => setRevisionPreview(null)}
                  >
                    Close
                  </button>
                </div>
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    fontSize: 10,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {revisionPreview.content ?? '(no content)'}
                </pre>
              </div>
            )}
          </div>

          <div
            data-testid="web-runs"
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--border, #333)',
            }}
          >
            <div className="muted" style={{ marginBottom: 8 }}>
              Runs
            </div>
            {runs.length === 0 ? (
              <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                No runs yet.
              </p>
            ) : (
              <ul className="list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {runs.map((r) => {
                  const terminal = isRunTerminal(r.status);
                  const promptSlice = (r.prompt ?? '').replace(/[\0\r\n]+/g, ' ').slice(0, 48);
                  return (
                    <li
                      key={r.id}
                      data-testid={`web-run-${r.id}`}
                      style={{
                        padding: '0.35rem 0',
                        borderBottom: '1px solid var(--border, #2a2a2a)',
                        fontSize: 11,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{
                            flex: '1 1 auto',
                            minWidth: 0,
                            border: 'none',
                            background: 'transparent',
                            color: selectedRunId === r.id ? 'var(--accent)' : 'var(--text)',
                            cursor: 'pointer',
                            padding: 0,
                            textAlign: 'left',
                            fontSize: 11,
                          }}
                          disabled={runsBusy}
                          onClick={() => void selectRun(r.id)}
                        >
                          <div>
                            <span className="mono">{r.status}</span>
                            {' · '}
                            <span className="mono muted">{r.id.slice(0, 8)}</span>
                          </div>
                          {promptSlice ? (
                            <div className="muted" style={{ fontSize: 10, wordBreak: 'break-all' }}>
                              {promptSlice}
                              {(r.prompt ?? '').length > 48 ? '…' : ''}
                            </div>
                          ) : null}
                          {r.createdAt ? (
                            <div className="muted" style={{ fontSize: 10 }}>
                              {r.createdAt}
                            </div>
                          ) : null}
                        </button>
                        {!terminal && (
                          <button
                            type="button"
                            className="btn"
                            style={{ fontSize: 11, padding: '0.2rem 0.45rem' }}
                            disabled={runsBusy}
                            data-testid={`web-run-cancel-${r.id}`}
                            onClick={() => void cancelRun(r.id)}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {selectedRunId && (
              <div
                data-testid="web-run-events"
                style={{
                  marginTop: 8,
                  maxHeight: 160,
                  overflow: 'auto',
                  border: '1px solid var(--border, #333)',
                  borderRadius: 4,
                  padding: 8,
                }}
              >
                <div
                  className="row"
                  style={{ justifyContent: 'space-between', marginBottom: 4, fontSize: 10 }}
                >
                  <span className="mono muted">
                    Events · {selectedRunId.slice(0, 8)}
                  </span>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{
                      fontSize: 10,
                      padding: 0,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      color: 'var(--text-muted, #888)',
                    }}
                    onClick={() => {
                      setSelectedRunId(null);
                      setRunEvents([]);
                    }}
                  >
                    Close
                  </button>
                </div>
                {runEvents.length === 0 ? (
                  <p className="muted" style={{ fontSize: 10, margin: 0 }}>
                    No events.
                  </p>
                ) : (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                    {runEvents.map((ev) => {
                      let snippet = '';
                      if (ev.data && typeof ev.data === 'object' && ev.data !== null) {
                        const d = ev.data as { chunk?: unknown; error?: unknown };
                        if (typeof d.chunk === 'string' && d.chunk) {
                          snippet = d.chunk.replace(/[\0\r\n]+/g, ' ').slice(0, 80);
                        } else if (typeof d.error === 'string' && d.error) {
                          snippet = d.error.replace(/[\0\r\n]+/g, ' ').slice(0, 80);
                        }
                      }
                      return (
                        <li
                          key={ev.id}
                          className="mono"
                          style={{
                            fontSize: 10,
                            padding: '2px 0',
                            borderBottom: '1px solid var(--border, #2a2a2a)',
                            wordBreak: 'break-all',
                          }}
                        >
                          <span>{ev.type}</span>
                          {snippet ? (
                            <span className="muted"> · {snippet}</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
