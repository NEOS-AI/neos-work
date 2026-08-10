/**
 * Web Workflows list — create / open / delete (v0.24 dual-surface).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type WorkflowSummary = {
  id: string;
  name: string;
  domain: string;
  primaryDomain?: string;
  updatedAt?: string;
  createdAt?: string;
};

const DOMAINS = ['general', 'coding', 'research', 'finance'] as const;

function scrubText(raw: unknown, max = 200): string {
  if (raw == null) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  return s.replace(/[\0\r\n]+/g, ' ').slice(0, max).trim();
}

function formatUpdated(iso?: string): string {
  if (!iso || typeof iso !== 'string' || /[\0\r\n]/.test(iso)) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return scrubText(iso, 40) || '—';
  try {
    return d.toLocaleString();
  } catch {
    return scrubText(iso, 40) || '—';
  }
}

export function Workflows() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );

  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState<(typeof DOMAINS)[number]>('general');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
      const res = await client.listWorkflows();
      const rows = Array.isArray(res.data) ? res.data : [];
      setWorkflows(
        rows.map((w) => ({
          id: String(w.id ?? ''),
          name: scrubText(w.name, 200) || String(w.id ?? ''),
          domain: scrubText(w.primaryDomain ?? w.domain, 40) || 'general',
          primaryDomain: w.primaryDomain,
          updatedAt: w.updatedAt,
          createdAt: w.createdAt,
        })),
      );
    } catch (err) {
      setWorkflows([]);
      setError(scrubError(err, 'Failed to load workflows'));
      if (handleAuthError(err)) return;
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, nav, handleAuthError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const closeModal = () => {
    setShowModal(false);
    setNewName('');
    setNewDomain('general');
    setCreateError(null);
    setCreating(false);
  };

  const handleCreate = async () => {
    if (creating) return;
    if (typeof newName !== 'string' || /[\0\r\n]/.test(newName) || !newName.trim()) {
      setCreateError('Workflow name is invalid');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const triggerId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `t-${Date.now()}`;
      const outputId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `o-${Date.now()}`;
      const edgeId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `e-${Date.now()}`;
      const res = await client.createWorkflow({
        name: newName.trim(),
        primaryDomain: newDomain,
        domain: newDomain,
        domainPackIds: [newDomain],
        nodes: [
          {
            id: triggerId,
            type: 'trigger',
            label: 'Trigger',
            position: { x: 80, y: 200 },
            config: {},
          },
          {
            id: outputId,
            type: 'output',
            label: 'Output',
            position: { x: 520, y: 200 },
            config: {},
          },
        ],
        edges: [{ id: edgeId, source: triggerId, target: outputId }],
      });
      if (!res.ok || !res.data?.id) {
        setCreateError(scrubError(res.error, 'Failed to create workflow'));
        return;
      }
      closeModal();
      nav(`/workflows/${encodeURIComponent(res.data.id)}`);
    } catch (err) {
      if (handleAuthError(err)) return;
      setCreateError(scrubError(err, 'Failed to create workflow'));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (deletingId) return;
    if (typeof id !== 'string' || !id.trim() || /[\0\r\n]/.test(id)) {
      setActionError('Invalid workflow id');
      return;
    }
    const nameSafe = scrubText(name, 200) || id;
    if (!window.confirm(`Delete workflow “${nameSafe}”? This cannot be undone.`)) {
      return;
    }
    setDeletingId(id);
    setActionError(null);
    try {
      const res = await client.deleteWorkflow(id);
      if (!res.ok) {
        setActionError(scrubError(res.error, 'Failed to delete workflow'));
        return;
      }
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
    } catch (err) {
      if (handleAuthError(err)) return;
      setActionError(scrubError(err, 'Failed to delete workflow'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="layout stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>Workflows</h1>
          <p className="muted">Build and run agent workflows on the daemon</p>
        </div>
        <div className="row">
          <Link to="/projects" className="btn btn-ghost" data-testid="wf-nav-projects">
            Projects
          </Link>
          <Link to="/media" className="btn btn-ghost" data-testid="wf-nav-media">
            Media
          </Link>
          <Link to="/settings" className="btn btn-ghost" data-testid="wf-nav-settings">
            Settings
          </Link>
          <Link to="/" className="btn btn-ghost">
            Connection
          </Link>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button
          type="button"
          className="btn"
          data-testid="workflow-create-open"
          onClick={() => {
            setShowModal(true);
            setCreateError(null);
          }}
        >
          New workflow
        </button>
      </div>

      {error && (
        <p className="err" role="alert" data-testid="workflow-list-error">
          {error}
        </p>
      )}
      {actionError && (
        <p className="err" role="alert" data-testid="workflow-action-error">
          {actionError}
        </p>
      )}

      {loading ? (
        <p className="muted" data-testid="workflow-list-loading">
          Loading…
        </p>
      ) : workflows.length === 0 ? (
        <p className="muted" data-testid="workflow-list-empty">
          No workflows yet. Create one to open the graph editor.
        </p>
      ) : (
        <ul className="list" data-testid="workflow-list">
          {workflows.map((w) => (
            <li key={w.id} data-testid={`workflow-row-${w.id}`}>
              <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
                <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
                  <Link
                    to={`/workflows/${encodeURIComponent(w.id)}`}
                    data-testid={`workflow-open-${w.id}`}
                    style={{ fontWeight: 600 }}
                  >
                    {w.name}
                  </Link>
                  <span className="muted">
                    {w.domain}
                    {' · '}
                    updated {formatUpdated(w.updatedAt)}
                  </span>
                </div>
                <div className="row">
                  <Link
                    to={`/workflows/${encodeURIComponent(w.id)}`}
                    className="btn btn-ghost"
                    data-testid={`workflow-edit-${w.id}`}
                  >
                    Edit
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    data-testid={`workflow-delete-${w.id}`}
                    disabled={deletingId === w.id}
                    onClick={() => void handleDelete(w.id, w.name)}
                  >
                    {deletingId === w.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Create workflow"
          data-testid="workflow-create-modal"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <form
            className="card stack"
            style={{ width: '100%', maxWidth: 420 }}
            data-testid="workflow-create-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <h2 style={{ margin: 0, fontSize: '1.1rem' }}>New workflow</h2>
            <label className="stack" style={{ gap: 4 }}>
              <span className="muted">Name</span>
              <input
                className="input"
                data-testid="workflow-create-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="My workflow"
                autoFocus
                maxLength={200}
              />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              <span className="muted">Domain</span>
              <select
                className="input"
                data-testid="workflow-create-domain"
                value={newDomain}
                onChange={(e) =>
                  setNewDomain(e.target.value as (typeof DOMAINS)[number])
                }
              >
                {DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            {createError && (
              <p className="err" role="alert" data-testid="workflow-create-error">
                {createError}
              </p>
            )}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-ghost"
                data-testid="workflow-create-cancel"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn"
                data-testid="workflow-create-submit"
                disabled={creating}
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
