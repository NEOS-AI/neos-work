/**
 * Design Project workspace (v0.5.8 / DESIGN.md context strip + Task 5 DS link).
 * Files | Layers | Preview/Code/Split/Inspect | Chat / Comments / Revisions / Context.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useBlocker } from 'react-router-dom';
import {
  DesignEditor,
  createEmptyBuffer,
  editContextFromSelection,
  isDirty,
  reduceEditorBuffer,
  shouldSkipDiskReload,
  type BridgeSelectPayload,
  type DesignEditorMode,
  type EditorBufferState,
} from '@neos-work/design-editor';
import {
  isTerminalRunStatus,
  type SelectionState,
} from '@neos-work/shared';
import {
  formatPresenceLeaveMessage,
  PresencePeersBar,
  type PeerSelectionInfo,
  type PresencePeerInfo,
} from '@neos-work/ui-app';

import { useEngine } from '../hooks/useEngine.js';
import type {
  DesignProject,
  DesignSystem,
  LiveArtifact,
  ProjectFileEntry,
  ProjectFileRevision,
  ProjectPreviewComment,
} from '../lib/engine.js';
import { normalizeProjectRelPath } from '../lib/engine.js';
import { ConfirmLeaveModal } from '../components/workflow/ConfirmLeaveModal.js';
import { safeEntityId, scrubDisplayText } from '../lib/format-duration.js';

export function ProjectWorkspace() {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const navigate = useNavigate();
  const { id: rawId } = useParams<{ id: string }>();
  const projectId = safeEntityId(rawId ?? '') || '';

  const [project, setProject] = useState<DesignProject | null>(null);
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [buffer, setBuffer] = useState<EditorBufferState>(() => createEmptyBuffer());
  const [mode, setMode] = useState<DesignEditorMode>('split');
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Chat / runs panel
  const [chatPrompt, setChatPrompt] = useState('');
  const [chatAgentId, setChatAgentId] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLog, setChatLog] = useState<string[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  /** Latest project run status (queued / running / succeeded / failed / canceled). */
  const [runStatus, setRunStatus] = useState<string | null>(null);
  /** Abort handle for active `streamProjectRunEvents` SSE. */
  const runStreamStopRef = useRef<(() => void) | null>(null);
  /** True while user cancel owns terminal UI (skip double-log from stream finally). */
  const runCancelRequestedRef = useRef(false);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  /** Inspect/bridge detail (outerHTML) for selection-scoped AI context. */
  const [selectDetail, setSelectDetail] = useState<BridgeSelectPayload | null>(null);

  type SideTab = 'chat' | 'comments' | 'revisions' | 'context' | 'live';
  const [sideTab, setSideTab] = useState<SideTab>('chat');
  const [comments, setComments] = useState<ProjectPreviewComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [revisions, setRevisions] = useState<ProjectFileRevision[]>([]);
  const [revisionError, setRevisionError] = useState<string | null>(null);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [liveArtifacts, setLiveArtifacts] = useState<LiveArtifact[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveName, setLiveName] = useState('Live card');
  const [liveTemplate, setLiveTemplate] = useState('<h1>{{title}}</h1><p>{{body}}</p>');
  const [liveInputsJson, setLiveInputsJson] = useState('{"title":"Hello","body":"Live artifact"}');
  const [liveSelectedId, setLiveSelectedId] = useState<string | null>(null);

  // Design system context strip (Task 1c residual / Task 5)
  const [designSystems, setDesignSystems] = useState<DesignSystem[]>([]);
  const [dsContent, setDsContent] = useState<string | null>(null);
  const [dsTokens, setDsTokens] = useState<string | null>(null);
  const [dsBusy, setDsBusy] = useState(false);
  const [dsError, setDsError] = useState<string | null>(null);

  const dirty = isDirty(buffer);
  const bufferRef = useRef(buffer);
  bufferRef.current = buffer;
  const [collabSelf, setCollabSelf] = useState<PresencePeerInfo | null>(null);
  const [collabPeers, setCollabPeers] = useState<PresencePeerInfo[]>([]);
  const [collabSessionId, setCollabSessionId] = useState<string | null>(null);
  const collabSessionRef = useRef<string | null>(null);
  collabSessionRef.current = collabSessionId;
  /** Brief presence leave notice (idle / leave / evicted). */
  const [collabNotice, setCollabNotice] = useState<string | null>(null);
  const collabNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [foreignLocks, setForeignLocks] = useState<
    Record<string, { sessionId: string; displayName: string }>
  >({});
  /** sessionId → peer selection (v0.7 M2). */
  const [peerSelections, setPeerSelections] = useState<Record<string, PeerSelectionInfo>>({});
  /** Revision content preview from GET …/revisions/:id */
  const [revisionPreview, setRevisionPreview] = useState<ProjectFileRevision | null>(null);
  const blocker = useBlocker(dirty);

  const loadProject = useCallback(async () => {
    if (!client || !projectId) {
      setPageError('Invalid project id');
      setLoading(false);
      return;
    }
    setLoading(true);
    setPageError(null);
    try {
      const res = await client.getProject(projectId);
      if (!res.ok || !res.data) {
        setPageError(
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
            || 'Failed to load project',
        );
        setProject(null);
        return;
      }
      setProject(res.data);
      const filesRes = await client.listProjectFiles(projectId);
      const entries = filesRes.ok && filesRes.data ? filesRes.data : [];
      setFiles(entries);
      const entry =
        res.data.entryFile
        || entries.find((e) => e.type === 'file' && e.path.endsWith('.html'))?.path
        || entries.find((e) => e.type === 'file')?.path
        || null;
      if (entry) {
        const fileRes = await client.readProjectFile(projectId, entry);
        if (fileRes.ok && fileRes.data) {
          setBuffer(
            reduceEditorBuffer(createEmptyBuffer(), {
              type: 'open',
              path: entry,
              content: fileRes.data.content,
              hash: fileRes.data.hash,
            }),
          );
        }
      } else {
        setBuffer(createEmptyBuffer());
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load project';
      setPageError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to load project',
      );
    } finally {
      setLoading(false);
    }
  }, [client, projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Collab presence + file locks + selection (v0.6 M1/M3 + v0.7 M2)
  useEffect(() => {
    if (!client || !projectId) return;
    setCollabSelf(null);
    setCollabPeers([]);
    setCollabSessionId(null);
    setForeignLocks({});
    setPeerSelections({});
    const stop = client.streamProjectCollab(
      projectId,
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
            const p = normalizeProjectRelPath(l.path);
            if (!p) continue;
            next[p] = { sessionId: l.sessionId, displayName: l.displayName };
          }
          setForeignLocks(next);
          const selMap: Record<string, PeerSelectionInfo> = {};
          for (const s of ev.selections ?? []) {
            if (selfId && s.sessionId === selfId) continue;
            if (s.path == null && s.selector == null) continue;
            const pathNorm =
              s.path == null ? null : normalizeProjectRelPath(s.path) || null;
            selMap[s.sessionId] = {
              ...(s as PeerSelectionInfo),
              path: pathNorm,
            };
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
              const msg = formatPresenceLeaveMessage(
                gone.displayName,
                typeof ev.reason === 'string' ? ev.reason : undefined,
              );
              setCollabNotice(msg);
              if (collabNoticeTimer.current) clearTimeout(collabNoticeTimer.current);
              collabNoticeTimer.current = setTimeout(() => setCollabNotice(null), 4000);
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
          const p = normalizeProjectRelPath(lock.path);
          if (!p) return;
          setForeignLocks((m) => {
            if (collabSessionRef.current && lock.sessionId === collabSessionRef.current) return m;
            return {
              ...m,
              [p]: { sessionId: lock.sessionId, displayName: lock.displayName },
            };
          });
        } else if (ev.type === 'lock.released' && ev.path) {
          const p = normalizeProjectRelPath(ev.path);
          if (!p) return;
          setForeignLocks((m) => {
            if (!(p in m)) return m;
            const n = { ...m };
            delete n[p];
            return n;
          });
        } else if (ev.type === 'selection.changed' && ev.selection) {
          const sel = ev.selection as PeerSelectionInfo;
          if (collabSessionRef.current && sel.sessionId === collabSessionRef.current) return;
          const pathNorm =
            sel.path == null ? null : normalizeProjectRelPath(sel.path) || null;
          setPeerSelections((m) => {
            if (pathNorm == null && sel.selector == null) {
              if (!(sel.sessionId in m)) return m;
              const n = { ...m };
              delete n[sel.sessionId];
              return n;
            }
            return { ...m, [sel.sessionId]: { ...sel, path: pathNorm } };
          });
        }
      },
      { displayName: 'Desktop' },
    );
    return () => stop();
  }, [client, projectId]);

  // Multi-replica resilience: REST peers/locks/selections + heartbeat if SSE was missed
  useEffect(() => {
    if (!client || !projectId || !collabSessionId) return;
    const sessionId = collabSessionId;
    const tick = () => {
      void client.collabHeartbeat(projectId, { sessionId }).catch(() => {});
      void client
        .listCollabPeers(projectId)
        .then((res) => {
          if (!res.ok || !res.data?.peers || !Array.isArray(res.data.peers)) return;
          const selfId = collabSessionRef.current;
          const next: PresencePeerInfo[] = res.data.peers
            .filter(
              (p) =>
                typeof p.sessionId === 'string'
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
        .listCollabLocks(projectId)
        .then((res) => {
          if (!res.ok || !res.data?.locks || !Array.isArray(res.data.locks)) return;
          const selfId = collabSessionRef.current;
          const next: Record<string, { sessionId: string; displayName: string }> = {};
          for (const l of res.data.locks) {
            if (!l || typeof l.sessionId !== 'string' || typeof l.path !== 'string') continue;
            if (selfId && l.sessionId === selfId) continue;
            const p = normalizeProjectRelPath(l.path);
            if (!p) continue;
            next[p] = {
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
        .listCollabSelections(projectId)
        .then((res) => {
          if (!res.ok || !res.data?.selections || !Array.isArray(res.data.selections)) return;
          const selfId = collabSessionRef.current;
          const selMap: Record<string, PeerSelectionInfo> = {};
          for (const s of res.data.selections) {
            if (!s || typeof s.sessionId !== 'string' || !s.sessionId) continue;
            if (selfId && s.sessionId === selfId) continue;
            if (s.path == null && s.selector == null) continue;
            const pathNorm =
              s.path == null ? null : normalizeProjectRelPath(s.path) || null;
            selMap[s.sessionId] = {
              ...(s as PeerSelectionInfo),
              path: pathNorm,
            };
          }
          setPeerSelections(selMap);
        })
        .catch(() => {});
    };
    const first = window.setTimeout(tick, 12_000);
    const iv = window.setInterval(tick, 45_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(iv);
    };
  }, [client, projectId, collabSessionId]);

  const openBufferPath = normalizeProjectRelPath(buffer.path);
  const lockedByOther =
    openBufferPath && foreignLocks[openBufferPath]
      ? foreignLocks[openBufferPath]!.displayName
      : null;

  useEffect(() => {
    if (!client || !projectId || !collabSessionId || !buffer.path) return;
    const path = normalizeProjectRelPath(buffer.path);
    if (!path) return;
    void client
      .collabLock(projectId, { sessionId: collabSessionId, path, action: 'acquire' })
      .then((res) => {
        if (!res.ok && res.data?.holder?.sessionId && res.data.holder.displayName) {
          const holder = res.data.holder;
          setForeignLocks((m) => ({
            ...m,
            [path]: { sessionId: holder.sessionId, displayName: holder.displayName },
          }));
        }
      });
    return () => {
      void client.collabLock(projectId, {
        sessionId: collabSessionId,
        path,
        action: 'release',
      });
    };
  }, [client, projectId, collabSessionId, buffer.path]);

  // M2/M3: publish local selection (+ multi selectors) for peer indicators
  const multiSelectorsKey = (selection?.multiSelectors ?? []).join('\0');
  const multiLayerIdsKey = (selection?.multiLayerIds ?? []).join('\0');
  useEffect(() => {
    if (!client || !projectId || !collabSessionId) return;
    const rawPath = selection?.filePath ?? buffer.path ?? null;
    const path =
      rawPath == null || rawPath === ''
        ? null
        : normalizeProjectRelPath(rawPath) || null;
    const selector = selection?.selector ?? null;
    const layerId = selection?.layerId ?? null;
    const selectors = selection?.multiSelectors;
    const layerIds = selection?.multiLayerIds;
    const t = window.setTimeout(() => {
      void client.collabSelection(projectId, {
        sessionId: collabSessionId,
        path,
        selector,
        layerId,
        selectors: selectors && selectors.length > 1 ? selectors : null,
        layerIds: layerIds && layerIds.length > 1 ? layerIds : null,
      });
    }, 120);
    return () => window.clearTimeout(t);
  }, [
    client,
    projectId,
    collabSessionId,
    selection?.filePath,
    selection?.selector,
    selection?.layerId,
    multiSelectorsKey,
    multiLayerIdsKey,
    buffer.path,
  ]);

  // Project file SSE — agent/remote writes → disk-changed (conflict if dirty)
  // Hash-aware skip: matching event/disk tip avoids re-read thrash (v0.5.30).
  useEffect(() => {
    if (!client || !projectId) return;
    const stop = client.streamProjectFileEvents(projectId, (ev) => {
      if (ev.type !== 'file.changed' && ev.type !== 'file.created') return;
      const p = normalizeProjectRelPath(ev.path);
      if (!p) return;
      void (async () => {
        try {
          const cur = bufferRef.current;
          if (normalizeProjectRelPath(cur.path) !== p) return;
          // Path already matched via normalize — pass buffer path so skip check is hash-only
          if (shouldSkipDiskReload(cur, { path: cur.path, hash: ev.hash ?? null })) {
            if (ev.type === 'file.created') {
              const filesRes = await client.listProjectFiles(projectId);
              if (filesRes.ok && filesRes.data) setFiles(filesRes.data);
            }
            return;
          }

          const res = await client.readProjectFile(projectId, p);
          if (!res.ok || !res.data) return;
          setBuffer((prev) => {
            if (normalizeProjectRelPath(prev.path) !== p) return prev;
            if (
              shouldSkipDiskReload(prev, {
                path: prev.path,
                hash: res.data!.hash ?? ev.hash ?? null,
              })
            ) {
              return prev;
            }
            return reduceEditorBuffer(prev, {
              type: 'disk-changed',
              content: res.data!.content,
              hash: res.data!.hash,
            });
          });
          // Refresh file list on create so tree stays accurate
          if (ev.type === 'file.created') {
            const filesRes = await client.listProjectFiles(projectId);
            if (filesRes.ok && filesRes.data) setFiles(filesRes.data);
          }
        } catch {
          // best-effort
        }
      })();
    });
    return () => stop();
  }, [client, projectId]);

  const openFile = useCallback(
    async (path: string) => {
      if (!client || !projectId) return;
      if (isDirty(buffer)) {
        const leave = window.confirm(t('project.unsavedLeave'));
        if (!leave) return;
      }
      setSaveError(null);
      try {
        const res = await client.readProjectFile(projectId, path);
        if (res.ok && res.data) {
          setBuffer(
            reduceEditorBuffer(createEmptyBuffer(), {
              type: 'open',
              path,
              content: res.data.content,
              hash: res.data.hash,
            }),
          );
        } else {
          setSaveError(
            scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
              || t('project.readFailed'),
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('project.readFailed');
        setSaveError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
      }
    },
    [client, projectId, buffer, t],
  );

  const handleSave = useCallback(async () => {
    if (!client || !projectId || !buffer.path || !isDirty(buffer)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await client.writeProjectFile(projectId, buffer.path, buffer.local, 'user');
      if (res.ok) {
        setBuffer((prev) =>
          reduceEditorBuffer(prev, {
            type: 'saved',
            content: prev.local,
            hash: res.data?.hash,
          }),
        );
        const filesRes = await client.listProjectFiles(projectId);
        if (filesRes.ok && filesRes.data) setFiles(filesRes.data);
        if (buffer.path) {
          const revRes = await client.listProjectRevisions(projectId, buffer.path);
          if (revRes.ok && revRes.data) setRevisions(revRes.data);
        }
      } else {
        setSaveError(
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
            || t('project.saveFailed'),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('project.saveFailed');
      setSaveError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
    } finally {
      setSaving(false);
    }
  }, [client, projectId, buffer, t]);

  const loadComments = useCallback(async () => {
    if (!client || !projectId) return;
    try {
      const res = await client.listProjectPreviewComments(projectId, buffer.path ?? undefined);
      if (res.ok && res.data) setComments(res.data);
    } catch {
      /* ignore */
    }
  }, [client, projectId, buffer.path]);

  const loadRevisions = useCallback(async () => {
    if (!client || !projectId || !buffer.path) {
      setRevisions([]);
      setRevisionPreview(null);
      return;
    }
    try {
      const res = await client.listProjectRevisions(projectId, buffer.path);
      if (res.ok && res.data) setRevisions(res.data);
      else setRevisions([]);
      setRevisionPreview(null);
    } catch {
      setRevisions([]);
      setRevisionPreview(null);
    }
  }, [client, projectId, buffer.path]);

  const loadLiveArtifacts = useCallback(async () => {
    if (!client || !projectId) {
      setLiveArtifacts([]);
      return;
    }
    setLiveError(null);
    try {
      const res = await client.listLiveArtifacts(projectId);
      if (res.ok && res.data) setLiveArtifacts(res.data);
      else {
        setLiveArtifacts([]);
        setLiveError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 200,
          }) || t('project.liveLoadFailed'),
        );
      }
    } catch (err) {
      setLiveArtifacts([]);
      const msg = err instanceof Error ? err.message : t('project.liveLoadFailed');
      setLiveError(scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || msg);
    }
  }, [client, projectId, t]);

  const handleLiveCreate = useCallback(async () => {
    if (!client || !projectId) return;
    if (/[\0\r\n]/.test(liveName) || !liveName.trim()) {
      setLiveError(t('project.liveInvalidName'));
      return;
    }
    let inputs: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(liveInputsJson) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        inputs = parsed as Record<string, unknown>;
      }
    } catch {
      setLiveError(t('project.liveInvalidInputs'));
      return;
    }
    setLiveBusy(true);
    setLiveError(null);
    try {
      const res = await client.createLiveArtifact({
        projectId,
        name: liveName.trim(),
        sourceTemplate: liveTemplate,
        inputs,
      });
      if (res.ok && res.data) {
        setLiveSelectedId(res.data.id);
        await loadLiveArtifacts();
      } else {
        setLiveError(
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 200 })
            || t('project.liveCreateFailed'),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('project.liveCreateFailed');
      setLiveError(scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || msg);
    } finally {
      setLiveBusy(false);
    }
  }, [client, projectId, liveName, liveTemplate, liveInputsJson, t, loadLiveArtifacts]);

  const handleLiveRefresh = useCallback(
    async (id: string) => {
      if (!client || !projectId) return;
      setLiveBusy(true);
      setLiveError(null);
      try {
        const res = await client.refreshLiveArtifact(id, projectId);
        if (res.ok) await loadLiveArtifacts();
        else {
          setLiveError(
            scrubDisplayText(res.error, { collapseLines: true, maxChars: 200 })
              || t('project.liveRefreshFailed'),
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('project.liveRefreshFailed');
        setLiveError(scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || msg);
      } finally {
        setLiveBusy(false);
      }
    },
    [client, projectId, t, loadLiveArtifacts],
  );

  const handleLiveDelete = useCallback(
    async (id: string) => {
      if (!client || !projectId) return;
      setLiveBusy(true);
      try {
        const res = await client.deleteLiveArtifact(id, projectId);
        if (res.ok) {
          if (liveSelectedId === id) setLiveSelectedId(null);
          await loadLiveArtifacts();
        } else {
          setLiveError(
            scrubDisplayText(res.error, { collapseLines: true, maxChars: 200 })
              || t('project.liveDeleteFailed'),
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('project.liveDeleteFailed');
        setLiveError(scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || msg);
      } finally {
        setLiveBusy(false);
      }
    },
    [client, projectId, liveSelectedId, t, loadLiveArtifacts],
  );


  const loadDesignSystems = useCallback(async () => {
    if (!client) return;
    try {
      const res = await client.listDesignSystems();
      if (res.ok && res.data) setDesignSystems(res.data);
    } catch {
      /* ignore */
    }
  }, [client]);

  const loadDesignContext = useCallback(async () => {
    if (!client || !project?.designSystemId) {
      setDsContent(null);
      setDsTokens(null);
      return;
    }
    setDsBusy(true);
    setDsError(null);
    try {
      const [cRes, tRes] = await Promise.all([
        client.getDesignSystemContent(project.designSystemId),
        client.getDesignSystemTokens(project.designSystemId),
      ]);
      setDsContent(cRes.ok && cRes.data ? cRes.data.content : null);
      setDsTokens(tRes.ok && tRes.data ? tRes.data.content : null);
      if (!cRes.ok && !tRes.ok) {
        setDsError(
          scrubDisplayText(cRes.error || tRes.error, { collapseLines: true, maxChars: 200 })
            || t('project.dsLoadFailed'),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('project.dsLoadFailed');
      setDsError(scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || msg);
    } finally {
      setDsBusy(false);
    }
  }, [client, project?.designSystemId, t]);

  useEffect(() => {
    if (sideTab === 'context') {
      void loadDesignSystems();
      void loadDesignContext();
    }
  }, [sideTab, loadDesignSystems, loadDesignContext]);

  const handleDesignSystemChange = useCallback(
    async (designSystemId: string) => {
      if (!client || !projectId) return;
      setDsBusy(true);
      setDsError(null);
      try {
        const res = await client.updateProject(projectId, {
          designSystemId: designSystemId || null,
        });
        if (!res.ok || !res.data) {
          setDsError(
            scrubDisplayText(res.error, { collapseLines: true, maxChars: 200 })
              || t('project.dsSaveFailed'),
          );
          return;
        }
        setProject(res.data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('project.dsSaveFailed');
        setDsError(scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || msg);
      } finally {
        setDsBusy(false);
      }
    },
    [client, projectId, t],
  );


  useEffect(() => {
    if (sideTab === 'comments') void loadComments();
    if (sideTab === 'revisions') void loadRevisions();
    if (sideTab === 'live') void loadLiveArtifacts();
  }, [sideTab, loadComments, loadRevisions, loadLiveArtifacts]);

  const handleAddComment = useCallback(async () => {
    if (!client || !projectId || !buffer.path) return;
    if (!selection?.selector) {
      setCommentError(t('project.commentNeedSelection'));
      return;
    }
    if (!commentBody.trim() || /\0/.test(commentBody)) {
      setCommentError(t('project.commentInvalid'));
      return;
    }
    setCommentBusy(true);
    setCommentError(null);
    try {
      const res = await client.createProjectPreviewComment(projectId, {
        filePath: buffer.path,
        selector: selection.selector,
        body: commentBody.trim(),
      });
      if (!res.ok) {
        setCommentError(
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
            || t('project.commentFailed'),
        );
        return;
      }
      setCommentBody('');
      await loadComments();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('project.commentFailed');
      setCommentError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
    } finally {
      setCommentBusy(false);
    }
  }, [client, projectId, buffer.path, selection, commentBody, t, loadComments]);

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      if (!client || !projectId) return;
      setCommentBusy(true);
      try {
        await client.deleteProjectPreviewComment(projectId, commentId);
        await loadComments();
      } finally {
        setCommentBusy(false);
      }
    },
    [client, projectId, loadComments],
  );

  const handleViewRevision = useCallback(
    async (revisionId: string) => {
      if (!client || !projectId) return;
      setRevisionBusy(true);
      setRevisionError(null);
      try {
        const res = await client.getProjectRevision(projectId, revisionId);
        if (!res.ok || !res.data) {
          setRevisionError(
            scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
              || t('project.revisionLoadFailed'),
          );
          setRevisionPreview(null);
          return;
        }
        setRevisionPreview(res.data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('project.revisionLoadFailed');
        setRevisionError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
        setRevisionPreview(null);
      } finally {
        setRevisionBusy(false);
      }
    },
    [client, projectId, t],
  );

  const handleRestoreRevision = useCallback(
    async (revisionId: string) => {
      if (!client || !projectId) return;
      if (isDirty(buffer)) {
        const leave = window.confirm(t('project.unsavedLeave'));
        if (!leave) return;
      }
      setRevisionBusy(true);
      setRevisionError(null);
      try {
        const res = await client.restoreProjectRevision(projectId, revisionId);
        if (!res.ok) {
          setRevisionError(
            scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
              || t('project.restoreFailed'),
          );
          return;
        }
        const path = res.data?.path ?? buffer.path;
        if (path) {
          const fileRes = await client.readProjectFile(projectId, path);
          if (fileRes.ok && fileRes.data) {
            setBuffer(
              reduceEditorBuffer(createEmptyBuffer(), {
                type: 'open',
                path,
                content: fileRes.data.content,
                hash: fileRes.data.hash,
              }),
            );
          }
        }
        await loadRevisions();
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('project.restoreFailed');
        setRevisionError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
      } finally {
        setRevisionBusy(false);
      }
    },
    [client, projectId, buffer, t, loadRevisions],
  );

  const appendLog = useCallback((line: string) => {
    const safe = scrubDisplayText(line, { collapseLines: true, maxChars: 500 }) || line;
    setChatLog((prev) => [...prev.slice(-200), safe]);
  }, []);

  const handleCancelRun = useCallback(async () => {
    if (!client || !activeRunId) return;
    runCancelRequestedRef.current = true;
    // Abort SSE first so the chat send await unblocks
    runStreamStopRef.current?.();
    runStreamStopRef.current = null;
    try {
      const res = await client.cancelProjectRun(activeRunId);
      if (res.ok) {
        const status = res.data?.status ?? 'canceled';
        setRunStatus(status);
        appendLog(`✓ ${status}`);
      } else {
        // 409 already-terminal (or other error) — refresh via GET
        const st = await client.getProjectRun(activeRunId);
        if (st.ok && st.data) {
          setRunStatus(st.data.status);
          if (isTerminalRunStatus(st.data.status)) {
            appendLog(
              `✓ ${st.data.status}${st.data.error ? `: ${st.data.error}` : ''}`,
            );
          } else {
            setChatError(
              scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
                || t('project.cancelFailed'),
            );
          }
        } else {
          setChatError(
            scrubDisplayText(res.error || st.error, { collapseLines: true, maxChars: 300 })
              || t('project.cancelFailed'),
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('project.cancelFailed');
      setChatError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
    } finally {
      setChatBusy(false);
    }
  }, [client, activeRunId, appendLog, t]);

  const handleChatSend = useCallback(async () => {
    if (!client || !projectId) return;
    // Null bytes rejected; newlines allowed in multi-line prompts
    if (/\0/.test(chatPrompt)) {
      setChatError(t('project.chatInvalid'));
      return;
    }
    if (!chatPrompt.trim()) return;
    setChatBusy(true);
    setChatError(null);
    runCancelRequestedRef.current = false;
    try {
      const selectionSnippet =
        selectDetail?.outerHTML?.slice(0, 8_000)
        || (selection?.selector
          ? `<!-- selector: ${selection.selector} -->`
          : undefined);
      const editContext = selection
        ? editContextFromSelection(selection, {
            // Prefer selected element outerHTML; fall back to selector hint (not whole file).
            snippet: selectionSnippet,
            mode: 'replace-selection',
          })
        : buffer.path
          ? {
              filePath: buffer.path,
              mode: 'patch' as const,
              snippet: buffer.local.slice(0, 8_000),
            }
          : undefined;
      // dryRun when no agent selected; live CLI when agentId set
      const res = await client.createProjectRun({
        projectId,
        prompt: chatPrompt.trim(),
        agentId: chatAgentId || undefined,
        dryRun: !chatAgentId,
        editContext,
      });
      if (!res.ok || !res.data) {
        setChatError(
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
            || t('project.chatFailed'),
        );
        return;
      }
      setActiveRunId(res.data.id);
      setRunStatus(res.data.status);
      appendLog(`→ run ${res.data.id.slice(0, 8)}… (${res.data.status})`);
      setChatPrompt('');

      const runId = res.data.id;
      const logRunEvent = (ev: { type: string; data?: unknown }) => {
        const detail =
          ev.type === 'run.stdout' && ev.data && typeof ev.data === 'object' && 'chunk' in ev.data
            ? String((ev.data as { chunk: string }).chunk).slice(0, 120)
            : ev.type === 'run.failed' && ev.data && typeof ev.data === 'object' && 'error' in ev.data
              ? String((ev.data as { error: string }).error)
              : '';
        appendLog(detail ? `${ev.type}: ${detail}` : ev.type);
      };

      const applyTerminalStatus = async (): Promise<boolean> => {
        const st = await client.getProjectRun(runId);
        if (st.ok && st.data && isTerminalRunStatus(st.data.status)) {
          setRunStatus(st.data.status);
          appendLog(`✓ ${st.data.status}${st.data.error ? `: ${st.data.error}` : ''}`);
          // Reload files if CLI may have written
          if (st.data.status === 'succeeded' && chatAgentId) {
            const filesRes = await client.listProjectFiles(projectId);
            if (filesRes.ok && filesRes.data) setFiles(filesRes.data);
          }
          return true;
        }
        if (st.ok && st.data?.status) {
          setRunStatus(st.data.status);
        }
        return false;
      };

      // Prefer SSE for live run events; fall back to short poll if stream fails
      let sawStreamEvent = false;
      let streamErrored = false;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (errored = false) => {
          if (settled) return;
          settled = true;
          runStreamStopRef.current = null;
          if (errored) streamErrored = true;
          resolve();
        };
        const stop = client.streamProjectRunEvents(
          runId,
          (ev) => {
            sawStreamEvent = true;
            logRunEvent(ev);
          },
          {
            onDone: () => finish(false),
            onError: () => finish(true),
          },
        );
        // Abort resolves the wait (engine abort does not call onDone/onError)
        runStreamStopRef.current = () => {
          stop();
          finish(false);
        };
      });

      // User cancel owns terminal log/status — avoid double append
      if (runCancelRequestedRef.current) {
        return;
      }

      // Always fetch final status once stream ends (or errors)
      let terminal = await applyTerminalStatus();

      // Short poll fallback when SSE fails immediately / yields nothing useful
      if (!terminal && (streamErrored || !sawStreamEvent)) {
        let after: string | undefined;
        for (let i = 0; i < 10; i++) {
          if (runCancelRequestedRef.current) return;
          const evRes = await client.listProjectRunEvents(runId, after);
          if (evRes.ok && evRes.data) {
            for (const ev of evRes.data) {
              after = ev.id;
              logRunEvent(ev);
            }
          }
          terminal = await applyTerminalStatus();
          if (terminal) break;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('project.chatFailed');
      setChatError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
    } finally {
      runStreamStopRef.current = null;
      setChatBusy(false);
    }
  }, [
    client,
    projectId,
    chatPrompt,
    chatAgentId,
    buffer.path,
    buffer.local,
    selection,
    selectDetail,
    t,
    appendLog,
  ]);

  const fileTree = useMemo(() => {
    return [...files].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
  }, [files]);

  if (!projectId) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">{t('project.invalidId')}</p>
        <Link to="/projects" className="mt-2 inline-block text-sm underline">
          {t('project.backToList')}
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>
        {t('common.loading')}
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 space-y-2">
        <p className="text-sm text-red-400" role="alert">
          {pageError || t('project.loadFailed')}
        </p>
        <button
          type="button"
          className="text-sm underline"
          style={{ color: 'var(--text-secondary)' }}
          onClick={() => navigate('/projects')}
        >
          {t('project.backToList')}
        </button>
      </div>
    );
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-0px)] min-h-0 flex-col">
      <header
        className="flex flex-wrap items-center gap-3 border-b px-4 py-2"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
      >
        <Link to="/projects" className="text-xs" style={{ color: 'var(--text-muted)' }}>
          ← {t('project.title')}
        </Link>
        <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {scrubDisplayText(project.name, { collapseLines: true, maxChars: 80 })}
          {dirty ? ' *' : ''}
        </h1>
        <PresencePeersBar peers={collabPeers} self={collabSelf} selections={peerSelections} />
        {lockedByOther && (
          <span
            className="text-[11px] text-red-300"
            data-testid="file-lock-banner"
            title="Advisory lock (hard-enforced when NEOS_SHARED_EDIT=1)"
          >
            Locked by {lockedByOther}
          </span>
        )}
      </header>

      {pageError && (
        <div className="border-b border-red-900/40 bg-red-950/20 px-4 py-1.5 text-xs text-red-300">
          {pageError}
        </div>
      )}
      {saveError && (
        <div
          className="border-b border-red-900/40 bg-red-950/20 px-4 py-1.5 text-xs text-red-300"
          role="alert"
        >
          {saveError}
        </div>
      )}
      {collabNotice && (
        <div
          className="border-b px-4 py-1.5 text-xs"
          style={{
            borderColor: 'var(--border-primary)',
            backgroundColor: 'var(--bg-tertiary, #2a2a2a)',
            color: 'var(--text-secondary)',
          }}
          data-testid="collab-leave-notice"
          role="status"
        >
          {collabNotice}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className="flex w-52 shrink-0 flex-col border-r"
          style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
        >
          <div
            className="border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-wide"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}
          >
            {t('project.files')}
          </div>
          <ul className="flex-1 overflow-auto py-1 text-xs">
            {fileTree.map((f) => {
              const depth = f.path.split('/').length - 1;
              const active = f.path === buffer.path;
              return (
                <li key={f.path}>
                  <button
                    type="button"
                    disabled={f.type === 'directory'}
                    onClick={() => {
                      if (f.type === 'file') void openFile(f.path);
                    }}
                    className="flex w-full items-center gap-1 truncate px-2 py-1 text-left disabled:cursor-default"
                    style={{
                      paddingLeft: 8 + depth * 10,
                      backgroundColor: active
                        ? 'color-mix(in srgb, var(--bg-tertiary) 90%, transparent)'
                        : undefined,
                      color:
                        f.type === 'directory'
                          ? 'var(--text-muted)'
                          : active
                            ? 'var(--text-primary)'
                            : 'var(--text-secondary)',
                    }}
                    title={f.path}
                  >
                    <span className="opacity-60">{f.type === 'directory' ? '▸' : '·'}</span>
                    <span className="truncate">
                      {scrubDisplayText(f.name, { collapseLines: true, maxChars: 60 })}
                    </span>
                    {f.isEntry && (
                      <span className="ml-auto text-[9px] text-emerald-400">entry</span>
                    )}
                  </button>
                </li>
              );
            })}
            {fileTree.length === 0 && (
              <li className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                {t('project.noFiles')}
              </li>
            )}
          </ul>
          <div
            className="border-t px-2 py-1.5 font-mono text-[10px]"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}
          >
            {scrubDisplayText(project.baseDir, { collapseLines: true, maxChars: 48 })}
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DesignEditor
            buffer={buffer}
            mode={mode}
            onModeChange={setMode}
            onEdit={(content) =>
              setBuffer((prev) => reduceEditorBuffer(prev, { type: 'edit', content }))
            }
            onSave={() => void handleSave()}
            saving={saving}
            selection={selection}
            onSelectionChange={(sel, detail) => {
              setSelection(sel);
              setSelectDetail(detail ?? null);
            }}
            peerAwareness={Object.entries(peerSelections)
              .filter(([, sel]) => {
                if (!openBufferPath) return false;
                const sp =
                  sel?.path != null ? normalizeProjectRelPath(sel.path) : '';
                return sp === openBufferPath;
              })
              .map(([sessionId, sel]) => ({
                sessionId,
                colorHint: sel?.colorHint,
                displayName: sel?.displayName,
                path: sel?.path ?? null,
                selector: sel?.selector ?? null,
                selectors: sel?.selectors,
              }))}
            onEditWithAi={(sel, detail) => {
              setSelection(sel);
              setSelectDetail(detail ?? null);
              const hint = sel.selector
                ? t('project.editWithAiHint', { selector: sel.selector })
                : t('project.editWithAi');
              setChatPrompt((prev) => (prev.trim() ? prev : hint));
            }}
            labels={{
              preview: t('project.mode.preview'),
              code: t('project.mode.code'),
              split: t('project.mode.split'),
              inspect: t('project.mode.inspect'),
              save: saving ? t('common.loading') : t('common.save'),
              dirty: t('project.dirty'),
              layers: t('project.layers'),
              layersSearch: t('project.layersSearch'),
              layersEmpty: t('project.layersEmpty'),
              editWithAi: t('project.editWithAi'),
              copySelector: t('project.copySelector'),
              selection: t('project.selection'),
            }}
            onResolveConflict={(choice, merged) =>
              setBuffer((prev) =>
                reduceEditorBuffer(prev, { type: 'resolve-conflict', choice, merged }),
              )
            }
          />
        </div>

        {/* Chat / Comments / Revisions */}
        <aside
          className="flex w-72 shrink-0 flex-col border-l"
          style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
          data-testid="project-side-panel"
        >
          <div
            className="flex border-b"
            style={{ borderColor: 'var(--border-primary)' }}
            role="tablist"
          >
            {(
              [
                ['chat', t('project.chat')],
                ['comments', t('project.comments')],
                ['revisions', t('project.revisions')],
                ['context', t('project.context')],
                ['live', t('project.live')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={sideTab === id}
                data-testid={`side-tab-${id}`}
                onClick={() => setSideTab(id)}
                className="flex-1 px-1 py-2 text-[10px] font-semibold uppercase tracking-wide"
                style={{
                  color: sideTab === id ? 'var(--text-primary)' : 'var(--text-muted)',
                  backgroundColor:
                    sideTab === id
                      ? 'color-mix(in srgb, var(--bg-tertiary) 80%, transparent)'
                      : 'transparent',
                  borderBottom:
                    sideTab === id ? '2px solid var(--accent, #6366f1)' : '2px solid transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {sideTab === 'chat' && (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-2" data-testid="project-chat">
              <select
                aria-label={t('project.chatAgent')}
                value={chatAgentId}
                onChange={(e) => setChatAgentId(e.target.value)}
                className="w-full rounded border px-2 py-1 text-xs"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="">{t('project.chatDryRun')}</option>
                <option value="cli-claude">Claude Code</option>
                <option value="cli-codex">Codex</option>
                <option value="cli-gemini">Gemini</option>
                <option value="cli-opencode">OpenCode</option>
                <option value="cli-cursor">Cursor Agent</option>
                <option value="cli-aider">Aider</option>
                <option value="cli-copilot">GitHub Copilot</option>
                <option value="cli-qwen">Qwen</option>
                <option value="cli-kimi">Kimi</option>
                <option value="cli-grok">Grok</option>
                <option value="cli-continue">Continue</option>
              </select>
              <textarea
                value={chatPrompt}
                onChange={(e) => setChatPrompt(e.target.value)}
                placeholder={t('project.chatPlaceholder')}
                rows={4}
                className="w-full resize-none rounded border p-2 text-xs"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                }}
                aria-label={t('project.chat')}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={chatBusy || !chatPrompt.trim()}
                  onClick={() => void handleChatSend()}
                  className="flex-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  style={{ backgroundColor: 'var(--accent, #6366f1)' }}
                >
                  {chatBusy ? t('common.loading') : t('project.chatSend')}
                </button>
                {activeRunId
                  && (chatBusy || (runStatus != null && !isTerminalRunStatus(runStatus))) && (
                  <button
                    type="button"
                    data-testid="project-run-cancel"
                    onClick={() => void handleCancelRun()}
                    className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                    style={{
                      borderColor: 'var(--border-primary)',
                      color: 'var(--text-primary)',
                      backgroundColor: 'var(--bg-secondary, transparent)',
                    }}
                  >
                    {t('project.chatCancel')}
                  </button>
                )}
              </div>
              {chatError && (
                <p className="text-[11px] text-red-400" role="alert">
                  {chatError}
                </p>
              )}
              {activeRunId && (
                <div
                  className="flex flex-wrap items-center gap-2 font-mono text-[10px]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <span>
                    run {activeRunId.slice(0, 8)}…
                  </span>
                  {runStatus && (
                    <span
                      data-testid="project-run-status"
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        backgroundColor:
                          runStatus === 'succeeded'
                            ? 'color-mix(in srgb, #22c55e 25%, transparent)'
                            : runStatus === 'failed' || runStatus === 'error'
                              ? 'color-mix(in srgb, #ef4444 25%, transparent)'
                              : runStatus === 'canceled' || runStatus === 'cancelled'
                                ? 'color-mix(in srgb, #a3a3a3 30%, transparent)'
                                : 'color-mix(in srgb, var(--accent, #6366f1) 25%, transparent)',
                        color: 'var(--text-primary)',
                      }}
                      title={t('project.runStatus')}
                    >
                      {runStatus}
                    </span>
                  )}
                </div>
              )}
              <div
                className="min-h-0 flex-1 overflow-auto rounded border p-2 font-mono text-[10px] leading-relaxed"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-secondary)',
                }}
                data-testid="project-chat-log"
              >
                {chatLog.length === 0 ? (
                  <span style={{ color: 'var(--text-muted)' }}>{t('project.chatEmpty')}</span>
                ) : (
                  chatLog.map((line, i) => (
                    <div key={`${i}-${line.slice(0, 12)}`}>{line}</div>
                  ))
                )}
              </div>
            </div>
          )}

          {sideTab === 'comments' && (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-2" data-testid="project-comments">
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {t('project.commentHint')}
              </p>
              {selection?.selector ? (
                <p
                  className="truncate font-mono text-[10px]"
                  style={{ color: 'var(--text-secondary)' }}
                  title={selection.selector}
                >
                  {selection.selector}
                </p>
              ) : (
                <p className="text-[10px] text-amber-400/90">{t('project.commentNeedSelection')}</p>
              )}
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder={t('project.commentPlaceholder')}
                rows={3}
                className="w-full resize-none rounded border p-2 text-xs"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                }}
                aria-label={t('project.comments')}
              />
              <button
                type="button"
                disabled={commentBusy || !commentBody.trim() || !selection?.selector || !buffer.path}
                onClick={() => void handleAddComment()}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent, #6366f1)' }}
                data-testid="comment-add"
              >
                {commentBusy ? t('common.loading') : t('project.commentAdd')}
              </button>
              {commentError && (
                <p className="text-[11px] text-red-400" role="alert">
                  {commentError}
                </p>
              )}
              <ul className="min-h-0 flex-1 space-y-2 overflow-auto text-xs">
                {comments.length === 0 ? (
                  <li style={{ color: 'var(--text-muted)' }}>{t('project.commentEmpty')}</li>
                ) : (
                  comments.map((c) => (
                    <li
                      key={c.id}
                      className="rounded border p-2"
                      style={{
                        borderColor: 'var(--border-primary)',
                        backgroundColor: 'var(--bg-primary)',
                      }}
                      data-testid={`comment-${c.id}`}
                    >
                      <div
                        className="mb-1 truncate font-mono text-[10px]"
                        style={{ color: 'var(--text-muted)' }}
                        title={c.selector}
                      >
                        {scrubDisplayText(c.selector, { collapseLines: true, maxChars: 80 })}
                      </div>
                      <div style={{ color: 'var(--text-secondary)' }}>
                        {scrubDisplayText(c.body, { collapseLines: true, maxChars: 200 })}
                      </div>
                      <button
                        type="button"
                        className="mt-1 text-[10px] underline"
                        style={{ color: 'var(--text-muted)' }}
                        onClick={() => void handleDeleteComment(c.id)}
                      >
                        {t('common.delete')}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}

          {sideTab === 'revisions' && (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-2" data-testid="project-revisions">
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {buffer.path
                  ? t('project.revisionsFor', { path: buffer.path })
                  : t('project.noFileOpen')}
              </p>
              {revisionError && (
                <p className="text-[11px] text-red-400" role="alert">
                  {revisionError}
                </p>
              )}
              <ul className="min-h-0 flex-1 space-y-1 overflow-auto text-xs">
                {revisions.length === 0 ? (
                  <li style={{ color: 'var(--text-muted)' }}>{t('project.revisionEmpty')}</li>
                ) : (
                  revisions.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center gap-2 rounded border px-2 py-1.5"
                      style={{
                        borderColor: 'var(--border-primary)',
                        backgroundColor: 'var(--bg-primary)',
                      }}
                      data-testid={`revision-${r.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {r.source} · {r.contentHash.slice(0, 8)}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                          {r.createdAt}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={revisionBusy}
                        className="shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium disabled:opacity-40"
                        style={{
                          borderColor: 'var(--border-primary)',
                          color: 'var(--text-secondary)',
                        }}
                        data-testid={`revision-view-${r.id}`}
                        onClick={() => void handleViewRevision(r.id)}
                      >
                        {t('project.viewRevision')}
                      </button>
                      <button
                        type="button"
                        disabled={revisionBusy}
                        className="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium text-white disabled:opacity-40"
                        style={{ backgroundColor: 'var(--accent, #6366f1)' }}
                        onClick={() => void handleRestoreRevision(r.id)}
                      >
                        {t('project.restore')}
                      </button>
                    </li>
                  ))
                )}
              </ul>
              {revisionPreview && (
                <div
                  className="mt-1 flex max-h-48 min-h-0 flex-col gap-1 rounded border p-2"
                  style={{
                    borderColor: 'var(--border-primary)',
                    backgroundColor: 'var(--bg-primary)',
                  }}
                  data-testid="revision-preview"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {revisionPreview.source} · {revisionPreview.contentHash.slice(0, 8)}
                    </span>
                    <button
                      type="button"
                      className="text-[10px]"
                      style={{ color: 'var(--text-muted)' }}
                      onClick={() => setRevisionPreview(null)}
                    >
                      {t('project.closePreview')}
                    </button>
                  </div>
                  <pre
                    className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px]"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {revisionPreview.content ?? t('project.revisionNoContent')}
                  </pre>
                </div>
              )}
            </div>
          )}

          {sideTab === 'context' && (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-2" data-testid="project-context">
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {t('project.contextHint')}
              </p>
              <label className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {t('project.designSystem')}
              </label>
              <select
                aria-label={t('project.designSystem')}
                data-testid="project-ds-select"
                value={project.designSystemId ?? ''}
                disabled={dsBusy}
                onChange={(e) => void handleDesignSystemChange(e.target.value)}
                className="w-full rounded border px-2 py-1 text-xs"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="">{t('project.dsNone')}</option>
                {designSystems.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.name}
                    {ds.source === 'bundled' ? ' (bundled)' : ''}
                  </option>
                ))}
              </select>
              {dsError && (
                <p className="text-[11px] text-red-400" role="alert">
                  {dsError}
                </p>
              )}
              {dsBusy && (
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {t('common.loading')}
                </p>
              )}
              <div
                className="min-h-0 flex-1 space-y-2 overflow-auto"
                data-testid="project-ds-preview"
              >
                {!project.designSystemId ? (
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {t('project.dsEmpty')}
                  </p>
                ) : (
                  <>
                    <div>
                      <div
                        className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        DESIGN.md
                      </div>
                      <pre
                        className="max-h-48 overflow-auto whitespace-pre-wrap rounded border p-2 font-mono text-[10px] leading-relaxed"
                        style={{
                          borderColor: 'var(--border-primary)',
                          backgroundColor: 'var(--bg-primary)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {dsContent
                          ? scrubDisplayText(dsContent.slice(0, 6_000), {
                              collapseLines: false,
                              maxChars: 6_000,
                            })
                          : t('project.dsNoContent')}
                      </pre>
                    </div>
                    {dsTokens && (
                      <div>
                        <div
                          className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          tokens.css
                        </div>
                        <pre
                          className="max-h-32 overflow-auto whitespace-pre-wrap rounded border p-2 font-mono text-[10px]"
                          style={{
                            borderColor: 'var(--border-primary)',
                            backgroundColor: 'var(--bg-primary)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {scrubDisplayText(dsTokens.slice(0, 3_000), {
                            collapseLines: false,
                            maxChars: 3_000,
                          })}
                        </pre>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {sideTab === 'live' && (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-2" data-testid="project-live">
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {t('project.liveHint')}
              </p>
              <input
                data-testid="live-name"
                value={liveName}
                onChange={(e) => setLiveName(e.target.value)}
                placeholder={t('project.liveName')}
                className="w-full rounded border px-2 py-1 text-xs"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                }}
              />
              <textarea
                data-testid="live-template"
                value={liveTemplate}
                onChange={(e) => setLiveTemplate(e.target.value)}
                rows={3}
                className="w-full resize-y rounded border px-2 py-1 font-mono text-[10px]"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                }}
                aria-label={t('project.liveTemplate')}
              />
              <textarea
                data-testid="live-inputs"
                value={liveInputsJson}
                onChange={(e) => setLiveInputsJson(e.target.value)}
                rows={2}
                className="w-full resize-y rounded border px-2 py-1 font-mono text-[10px]"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                }}
                aria-label={t('project.liveInputs')}
              />
              <button
                type="button"
                data-testid="live-create"
                disabled={liveBusy}
                onClick={() => void handleLiveCreate()}
                className="rounded px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent, #6366f1)' }}
              >
                {liveBusy ? t('common.loading') : t('project.liveCreate')}
              </button>
              {liveError && (
                <p className="text-[11px] text-red-400" role="alert">
                  {liveError}
                </p>
              )}
              <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
                {liveArtifacts.length === 0 ? (
                  <li className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {t('project.liveEmpty')}
                  </li>
                ) : (
                  liveArtifacts.map((a) => (
                    <li
                      key={a.id}
                      className="rounded border p-2"
                      style={{
                        borderColor:
                          liveSelectedId === a.id
                            ? 'var(--accent, #6366f1)'
                            : 'var(--border-primary)',
                        backgroundColor: 'var(--bg-primary)',
                      }}
                      data-testid={`live-item-${a.id}`}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => setLiveSelectedId(a.id)}
                      >
                        <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                          {scrubDisplayText(a.name, { collapseLines: true, maxChars: 80 }) || a.id}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          refreshes: {a.refreshCount ?? 0}
                          {a.sidecarPath
                            ? ` · ${scrubDisplayText(a.sidecarPath, { collapseLines: true, maxChars: 40 })}`
                            : ''}
                        </div>
                      </button>
                      {liveSelectedId === a.id && a.content && (
                        <pre
                          className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded border p-1 font-mono text-[10px]"
                          style={{
                            borderColor: 'var(--border-primary)',
                            color: 'var(--text-secondary)',
                          }}
                          data-testid="live-preview"
                        >
                          {scrubDisplayText(a.content.slice(0, 2000), {
                            collapseLines: false,
                            maxChars: 2000,
                          })}
                        </pre>
                      )}
                      <div className="mt-1 flex gap-2">
                        <button
                          type="button"
                          disabled={liveBusy}
                          className="text-[10px] font-medium"
                          style={{ color: 'var(--accent, #6366f1)' }}
                          onClick={() => void handleLiveRefresh(a.id)}
                        >
                          {t('project.liveRefresh')}
                        </button>
                        <button
                          type="button"
                          disabled={liveBusy}
                          className="text-[10px] text-red-400"
                          onClick={() => void handleLiveDelete(a.id)}
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {blocker.state === 'blocked' && (
        <ConfirmLeaveModal
          onConfirm={() => blocker.proceed?.()}
          onCancel={() => blocker.reset?.()}
        />
      )}
    </div>
  );
}

export default ProjectWorkspace;
