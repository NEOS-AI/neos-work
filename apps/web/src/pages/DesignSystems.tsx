/**
 * Web Design Systems — list / create / delete (v0.26).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type DsRow = {
  id: string;
  name: string;
  description?: string;
  source?: string;
};

export function DesignSystems() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );
  const [items, setItems] = useState<DsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.listDesignSystems();
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(scrubError(err, 'Failed to load design systems'));
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

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await client.createDesignSystem(name, description);
      if (!res.ok || !res.data?.id) {
        setError(scrubError(res.error, 'Create failed'));
        return;
      }
      setName('');
      setDescription('');
      nav(`/design-systems/${encodeURIComponent(res.data.id)}`);
    } catch (err) {
      setError(scrubError(err, 'Create failed'));
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this design system?')) return;
    const res = await client.deleteDesignSystem(id);
    if (!res.ok) {
      setError(scrubError(res.error, 'Delete failed'));
      return;
    }
    await reload();
  };

  return (
    <div className="layout stack" data-testid="design-systems-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Design systems</h1>
          <p className="muted">DESIGN.md catalogs for workflow / editor chrome</p>
        </div>
        <WebNav current="/design-systems" />
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <form
        className="card row"
        data-testid="ds-create-form"
        style={{ flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        <input
          className="input"
          data-testid="ds-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
        />
        <input
          className="input"
          data-testid="ds-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
        />
        <button type="submit" className="btn" data-testid="ds-create" disabled={creating}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul data-testid="ds-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((d) => (
            <li key={d.id} className="card row" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn btn-ghost"
                data-testid={`ds-open-${d.id}`}
                onClick={() => nav(`/design-systems/${encodeURIComponent(d.id)}`)}
              >
                <strong>{d.name}</strong>
                <span className="muted">{d.source ? ` · ${d.source}` : ''}</span>
              </button>
              {d.source !== 'bundled' && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`ds-delete-${d.id}`}
                  onClick={() => void handleDelete(d.id)}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
          {items.length === 0 && <li className="muted">No design systems</li>}
        </ul>
      )}
    </div>
  );
}
