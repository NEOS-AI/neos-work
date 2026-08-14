/**
 * Web Sessions — list/create/delete + chat SSE + workspaces (v0.25 Track A).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ALL_MODELS } from '@neos-work/shared';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type SessionRow = {
  id: string;
  workspace_id?: string;
  workspaceId?: string;
  title: string | null;
  provider: string;
  model: string;
  updated_at?: string;
};

type WorkspaceRow = { id: string; name: string; path?: string | null; type: string };

type ChatMsg = { id: string; role: string; content: string };

const MODELS = ALL_MODELS.filter((m) => m.providerId === 'anthropic' || m.providerId === 'google');

function sessionWorkspace(s: SessionRow): string {
  return s.workspace_id || s.workspaceId || 'default';
}

function sessionTitle(s: SessionRow): string {
  const t = typeof s.title === 'string' ? s.title.replace(/[\0\r\n]+/g, ' ').trim() : '';
  return t || s.id.slice(0, 8);
}

export function Sessions() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newWs, setNewWs] = useState('default');
  const [newModel, setNewModel] = useState(MODELS[0]?.id ?? '');
  const [wsName, setWsName] = useState('');
  const stopChatRef = useRef<(() => void) | null>(null);

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
        return true;
      }
      return false;
    },
    [nav],
  );

  const reload = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [s, w] = await Promise.all([client.listSessions(), client.listWorkspaces()]);
      setSessions(Array.isArray(s.data) ? s.data : []);
      setWorkspaces(Array.isArray(w.data) ? w.data : []);
      if (w.ok && Array.isArray(w.data) && w.data.length && newWs === 'default') {
        const def = w.data.find((x) => x.id === 'default');
        if (def) setNewWs(def.id);
      }
    } catch (err) {
      setError(scrubError(err, 'Failed to load sessions'));
      if (handleAuthError(err)) return;
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, handleAuthError, nav, newWs]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    return () => {
      stopChatRef.current?.();
    };
  }, []);

  const openSession = async (id: string) => {
    setActiveId(id);
    setError(null);
    try {
      const res = await client.listSessionMessages(id);
      const rows = Array.isArray(res.data) ? res.data : [];
      setMessages(
        rows.map((m) => ({
          id: m.id,
          role: m.role,
          content: typeof m.content === 'string' ? m.content : '',
        })),
      );
    } catch (err) {
      if (handleAuthError(err)) return;
      setError(scrubError(err, 'Failed to load messages'));
    }
  };

  const handleCreate = async () => {
    if (creating) return;
    const model = MODELS.find((m) => m.id === newModel) ?? MODELS[0];
    setCreating(true);
    setError(null);
    try {
      const res = await client.createSession({
        workspaceId: newWs || 'default',
        provider: model?.providerId,
        model: model?.id,
        thinkingMode: 'none',
      });
      if (!res.ok || !res.data?.id) {
        setError(scrubError(res.error, 'Failed to create session'));
        return;
      }
      await reload();
      await openSession(res.data.id);
    } catch (err) {
      if (handleAuthError(err)) return;
      setError(scrubError(err, 'Failed to create session'));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this session?')) return;
    const res = await client.deleteSession(id);
    if (!res.ok) {
      setError(scrubError(res.error, 'Delete failed'));
      return;
    }
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
    await reload();
  };

  const handleCreateWorkspace = async () => {
    if (!wsName.trim() || /[\0\r\n]/.test(wsName)) {
      setError('Workspace name is invalid');
      return;
    }
    const res = await client.createWorkspace({ name: wsName.trim() });
    if (!res.ok || !res.data?.id) {
      setError(scrubError(res.error, 'Failed to create workspace'));
      return;
    }
    setWsName('');
    setNewWs(res.data.id);
    await reload();
  };

  const handleDeleteWorkspace = async (id: string) => {
    if (id === 'default') return;
    if (!window.confirm('Delete this workspace?')) return;
    const res = await client.deleteWorkspace(id);
    if (!res.ok) {
      setError(scrubError(res.error, 'Failed to delete workspace'));
      return;
    }
    if (newWs === id) setNewWs('default');
    await reload();
  };

  const handleSend = () => {
    if (!activeId || sending || !draft.trim() || /\0/.test(draft)) return;
    const text = draft.trim();
    setDraft('');
    const userId = `u-${Date.now()}`;
    const asstId = `a-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: userId, role: 'user', content: text },
      { id: asstId, role: 'assistant', content: '' },
    ]);
    setSending(true);
    stopChatRef.current?.();
    stopChatRef.current = client.streamSessionChat(
      activeId,
      text,
      (chunk) => {
        if (chunk.type === 'error') {
          setError(scrubError(chunk.content, 'Chat error'));
          return;
        }
        if (chunk.type === 'text' && chunk.content) {
          setMessages((m) =>
            m.map((row) =>
              row.id === asstId ? { ...row, content: row.content + chunk.content } : row,
            ),
          );
        }
      },
      {
        onDone: () => setSending(false),
        onError: (err) => {
          setSending(false);
          setError(scrubError(err, 'Chat failed'));
        },
      },
    );
  };

  const handleStop = () => {
    stopChatRef.current?.();
    stopChatRef.current = null;
    if (activeId) void client.cancelSession(activeId);
    setSending(false);
  };

  return (
    <div className="layout stack" data-testid="sessions-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Sessions</h1>
          <p className="muted">Chat with the daemon (Cowork loop)</p>
        </div>
        <WebNav current="/sessions" />
      </div>

      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}

      <div className="row" style={{ alignItems: 'stretch', gap: 16, flexWrap: 'wrap' }}>
        <aside className="card stack" style={{ flex: '0 0 260px', minWidth: 220 }}>
          <form
            className="stack"
            data-testid="session-create-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <label className="stack" style={{ gap: 4 }}>
              <span className="muted">Workspace</span>
              <select
                className="input"
                data-testid="session-workspace"
                value={newWs}
                onChange={(e) => setNewWs(e.target.value)}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
                {workspaces.length === 0 && <option value="default">default</option>}
              </select>
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <span className="muted">Model</span>
              <select
                className="input"
                data-testid="session-model"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn" data-testid="session-create" disabled={creating}>
              {creating ? 'Creating…' : 'New session'}
            </button>
          </form>

          <div className="stack" data-testid="workspace-manager">
            <span className="muted">Workspaces</span>
            <div className="row">
              <input
                className="input"
                data-testid="workspace-name"
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                placeholder="New workspace"
              />
              <button
                type="button"
                className="btn btn-ghost"
                data-testid="workspace-create"
                onClick={() => void handleCreateWorkspace()}
              >
                Add
              </button>
            </div>
            <ul className="list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {workspaces.map((w) => (
                <li key={w.id} className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {w.name}
                  </span>
                  {w.id !== 'default' && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      data-testid={`workspace-delete-${w.id}`}
                      onClick={() => void handleDeleteWorkspace(w.id)}
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {loading ? (
            <p className="muted">Loading…</p>
          ) : (
            <ul className="list" data-testid="session-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {sessions.map((s) => (
                <li key={s.id} className="row" style={{ justifyContent: 'space-between', gap: 4 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    data-testid={`session-open-${s.id}`}
                    onClick={() => void openSession(s.id)}
                    style={{ fontWeight: activeId === s.id ? 600 : 400 }}
                  >
                    {sessionTitle(s)}
                    <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>
                      {sessionWorkspace(s)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    data-testid={`session-delete-${s.id}`}
                    onClick={() => void handleDelete(s.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
              {sessions.length === 0 && <li className="muted">No sessions yet</li>}
            </ul>
          )}
        </aside>

        <section className="card stack" style={{ flex: '1 1 360px' }} data-testid="session-chat">
          {!activeId ? (
            <p className="muted">Select or create a session</p>
          ) : (
            <>
              <div
                className="stack"
                data-testid="session-messages"
                style={{ minHeight: 240, maxHeight: 480, overflow: 'auto' }}
              >
                {messages.map((m) => (
                  <div key={m.id} data-testid={`msg-${m.role}`}>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {m.role}
                    </div>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                      {m.content}
                    </pre>
                  </div>
                ))}
              </div>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
              >
                <textarea
                  className="input"
                  data-testid="session-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  style={{ flex: 1 }}
                  placeholder="Ask the agent…"
                  disabled={sending}
                />
                {sending ? (
                  <button type="button" className="btn" data-testid="session-stop" onClick={handleStop}>
                    Stop
                  </button>
                ) : (
                  <button type="submit" className="btn" data-testid="session-send" disabled={!draft.trim()}>
                    Send
                  </button>
                )}
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
