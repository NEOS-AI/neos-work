/**
 * Web Deployments — list / preflight / create / refresh / delete (v0.26).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type DepRow = {
  id: string;
  provider: string;
  projectName?: string;
  url?: string;
  status: string;
  statusMessage?: string;
  workflowId?: string;
};

export function Deployments() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );
  const [items, setItems] = useState<DepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<'vercel' | 'cloudflare'>('vercel');
  const [projectName, setProjectName] = useState('neos-deploy');
  const [content, setContent] = useState('<!DOCTYPE html><html><body>hello</body></html>');
  const [busy, setBusy] = useState(false);
  const [preflight, setPreflight] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.listDeployments();
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(scrubError(err, 'Failed to load deployments'));
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
      }
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, nav]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handlePreflight = async () => {
    setBusy(true);
    setPreflight(null);
    try {
      const res = await client.deployPreflight(provider, projectName);
      if (!res.ok) {
        setError(scrubError(res.error, 'Preflight failed'));
        return;
      }
      const ready = res.data?.ready ? 'ready' : 'not ready';
      const checks = (res.data?.checks ?? [])
        .map((c) => `${c.key}:${c.ok ? 'ok' : 'fail'}`)
        .join(' ');
      setPreflight(`${ready}${checks ? ` · ${checks}` : ''}`);
    } catch (err) {
      setError(scrubError(err, 'Preflight failed'));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await client.createDeployment({ provider, content, projectName });
      if (!res.ok) {
        setError(scrubError(res.error, 'Deploy failed'));
        return;
      }
      await reload();
    } catch (err) {
      setError(scrubError(err, 'Deploy failed'));
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async (id: string) => {
    const res = await client.refreshDeployment(id);
    if (!res.ok) {
      setError(scrubError(res.error, 'Refresh failed'));
      return;
    }
    await reload();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this deployment record?')) return;
    const res = await client.deleteDeployment(id);
    if (!res.ok) {
      setError(scrubError(res.error, 'Delete failed'));
      return;
    }
    await reload();
  };

  return (
    <div className="layout stack" data-testid="deployments-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Deployments</h1>
          <p className="muted">Vercel / Cloudflare deploy history</p>
        </div>
        <WebNav current="/deployments" />
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <form
        className="card stack"
        data-testid="deploy-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <select
            className="input"
            data-testid="deploy-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'vercel' | 'cloudflare')}
          >
            <option value="vercel">vercel</option>
            <option value="cloudflare">cloudflare</option>
          </select>
          <input
            className="input"
            data-testid="deploy-project-name"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="project name"
          />
          <button type="button" className="btn btn-ghost" data-testid="deploy-preflight" disabled={busy} onClick={() => void handlePreflight()}>
            Preflight
          </button>
        </div>
        {preflight && (
          <p className="muted" data-testid="deploy-preflight-result">
            {preflight}
          </p>
        )}
        <textarea
          className="input"
          data-testid="deploy-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
        />
        <button type="submit" className="btn" data-testid="deploy-create" disabled={busy}>
          {busy ? 'Working…' : 'Deploy'}
        </button>
      </form>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul data-testid="deploy-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((d) => (
            <li key={d.id} className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong data-testid={`deploy-${d.id}`}>{d.projectName || d.id}</strong>
                <span className="muted">
                  {' '}
                  · {d.provider} · {d.status}
                </span>
                {d.url ? (
                  <div className="muted mono" style={{ fontSize: 12 }}>
                    {d.url}
                  </div>
                ) : null}
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`deploy-refresh-${d.id}`}
                  onClick={() => void handleRefresh(d.id)}
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`deploy-delete-${d.id}`}
                  onClick={() => void handleDelete(d.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="muted">No deployments</li>}
        </ul>
      )}
    </div>
  );
}
