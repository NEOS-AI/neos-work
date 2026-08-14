/**
 * Web Workers — read-only Domain Worker catalog (v0.25 Track A).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type WorkerRow = {
  id: string;
  name: string;
  description?: string;
  domain?: string;
  isBuiltIn?: boolean;
  mode?: string;
};

export function Workers() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );

  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.listWorkers();
      setWorkers(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(scrubError(err, 'Failed to load workers'));
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

  return (
    <div className="layout stack" data-testid="workers-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Workers</h1>
          <p className="muted">Domain workers (read-only on web)</p>
        </div>
        <WebNav current="/workers" />
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="list" data-testid="worker-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {workers.map((w) => (
            <li key={w.id} className="card" data-testid={`worker-${w.id}`}>
              <strong>{w.name || w.id}</strong>
              <span className="muted">
                {' '}
                · {w.domain || 'general'}
                {w.isBuiltIn ? ' · built-in' : ''}
                {w.mode ? ` · ${w.mode}` : ''}
              </span>
              {w.description ? <p className="muted">{w.description}</p> : null}
            </li>
          ))}
          {workers.length === 0 && <li className="muted">No workers</li>}
        </ul>
      )}
    </div>
  );
}
