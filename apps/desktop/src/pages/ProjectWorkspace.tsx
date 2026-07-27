/**
 * Design Project workspace (v0.5.4 / PLAN_FOR_V0_5_0 Task 1c Layers/Inspect + chat runs).
 * Files | Layers | Preview/Code/Split/Inspect | Chat.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useBlocker } from 'react-router-dom';
import {
  DesignEditor,
  createEmptyBuffer,
  editContextFromSelection,
  isDirty,
  reduceEditorBuffer,
  type DesignEditorMode,
  type EditorBufferState,
} from '@neos-work/design-editor';
import type { SelectionState } from '@neos-work/shared';

import { useEngine } from '../hooks/useEngine.js';
import type { DesignProject, ProjectFileEntry } from '../lib/engine.js';
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
  const [selection, setSelection] = useState<SelectionState | null>(null);

  const dirty = isDirty(buffer);
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

  const appendLog = useCallback((line: string) => {
    const safe = scrubDisplayText(line, { collapseLines: true, maxChars: 500 }) || line;
    setChatLog((prev) => [...prev.slice(-200), safe]);
  }, []);

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
    try {
      const editContext = selection
        ? editContextFromSelection(selection, {
            snippet: buffer.local.slice(0, 8_000),
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
      appendLog(`→ run ${res.data.id.slice(0, 8)}… (${res.data.status})`);
      setChatPrompt('');

      // Poll events a few times for dry-run / fast CLI failure
      let after: string | undefined;
      for (let i = 0; i < 40; i++) {
        const evRes = await client.listProjectRunEvents(res.data.id, after);
        if (evRes.ok && evRes.data) {
          for (const ev of evRes.data) {
            after = ev.id;
            const detail =
              ev.type === 'run.stdout' && ev.data && typeof ev.data === 'object' && 'chunk' in ev.data
                ? String((ev.data as { chunk: string }).chunk).slice(0, 120)
                : ev.type === 'run.failed' && ev.data && typeof ev.data === 'object' && 'error' in ev.data
                  ? String((ev.data as { error: string }).error)
                  : '';
            appendLog(detail ? `${ev.type}: ${detail}` : ev.type);
          }
        }
        const st = await client.getProjectRun(res.data.id);
        if (
          st.ok
          && st.data
          && (st.data.status === 'succeeded' || st.data.status === 'failed' || st.data.status === 'canceled')
        ) {
          appendLog(`✓ ${st.data.status}${st.data.error ? `: ${st.data.error}` : ''}`);
          // Reload files if CLI may have written
          if (st.data.status === 'succeeded' && chatAgentId) {
            const filesRes = await client.listProjectFiles(projectId);
            if (filesRes.ok && filesRes.data) setFiles(filesRes.data);
          }
          break;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('project.chatFailed');
      setChatError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
    } finally {
      setChatBusy(false);
    }
  }, [client, projectId, chatPrompt, chatAgentId, buffer.path, buffer.local, selection, t, appendLog]);

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
            onSelectionChange={(sel) => setSelection(sel)}
            onEditWithAi={(sel) => {
              setSelection(sel);
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

        {/* Chat / AI runs */}
        <aside
          className="flex w-64 shrink-0 flex-col border-l"
          style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
          data-testid="project-chat"
        >
          <div
            className="border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-wide"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}
          >
            {t('project.chat')}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
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
              <option value="cli-aider">Aider</option>
              <option value="cli-opencode">OpenCode</option>
              <option value="cli-cursor">Cursor Agent</option>
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
            <button
              type="button"
              disabled={chatBusy || !chatPrompt.trim()}
              onClick={() => void handleChatSend()}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: 'var(--accent, #6366f1)' }}
            >
              {chatBusy ? t('common.loading') : t('project.chatSend')}
            </button>
            {chatError && (
              <p className="text-[11px] text-red-400" role="alert">
                {chatError}
              </p>
            )}
            {activeRunId && (
              <p className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                run {activeRunId.slice(0, 8)}…
              </p>
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
