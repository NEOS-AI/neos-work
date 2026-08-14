/**
 * Web Templates — list starter workflows and instantiate (v0.26).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type TemplateRow = {
  name: string;
  description?: string;
  domain?: string;
  primaryDomain?: string;
  nodes?: unknown[];
  edges?: unknown[];
};

export function Templates() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );
  const [items, setItems] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.listTemplates();
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(scrubError(err, 'Failed to load templates'));
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

  const handleUse = async (tpl: TemplateRow) => {
    setCreating(tpl.name);
    setError(null);
    try {
      const res = await client.createWorkflow({
        name: tpl.name,
        description: tpl.description,
        domain: tpl.primaryDomain || tpl.domain,
        nodes: tpl.nodes,
        edges: tpl.edges,
      });
      if (!res.ok || !res.data?.id) {
        setError(scrubError(res.error, 'Failed to create workflow'));
        return;
      }
      nav(`/workflows/${encodeURIComponent(res.data.id)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
        return;
      }
      setError(scrubError(err, 'Failed to create workflow'));
    } finally {
      setCreating(null);
    }
  };

  return (
    <div className="layout stack" data-testid="templates-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Templates</h1>
          <p className="muted">Start a workflow from a domain template</p>
        </div>
        <WebNav current="/templates" />
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul data-testid="template-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((t) => (
            <li key={t.name} className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong data-testid={`template-${t.name}`}>{t.name}</strong>
                <span className="muted"> · {t.primaryDomain || t.domain || 'general'}</span>
                {t.description ? <p className="muted">{t.description}</p> : null}
              </div>
              <button
                type="button"
                className="btn"
                data-testid={`template-use-${t.name}`}
                disabled={creating === t.name}
                onClick={() => void handleUse(t)}
              >
                {creating === t.name ? '…' : 'Use'}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="muted">No templates</li>}
        </ul>
      )}
    </div>
  );
}
