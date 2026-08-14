/**
 * Web Domain Packs — read-only pack list (v0.25 Track A).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type PackRow = {
  id: string;
  name: string;
  description?: string;
  workerCount?: number;
  blockCount?: number;
  isBuiltIn?: boolean;
  enabled?: boolean;
  version?: string;
};

export function DomainPacks() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );

  const [packs, setPacks] = useState<PackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.listDomainPacks();
      setPacks(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(scrubError(err, 'Failed to load domain packs'));
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
    <div className="layout stack" data-testid="domain-packs-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Domain packs</h1>
          <p className="muted">Built-in and installed packs (read-only on web)</p>
        </div>
        <WebNav current="/domain-packs" />
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <label className="card row" style={{ alignItems: 'center' }}>
        <span className="muted">Install pack zip</span>
        <input
          type="file"
          accept=".zip,application/zip"
          data-testid="pack-zip-input"
          disabled={zipBusy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setZipBusy(true);
            setError(null);
            void client
              .installDomainPackFromZip(file)
              .then(async (res) => {
                if (!res.ok) {
                  setError(scrubError(res.error, 'Zip install failed'));
                  return;
                }
                await reload();
              })
              .catch((err) => setError(scrubError(err, 'Zip install failed')))
              .finally(() => setZipBusy(false));
          }}
        />
      </label>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="list" data-testid="pack-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {packs.map((p) => (
            <li key={p.id} className="card" data-testid={`pack-${p.id}`}>
              <strong>{p.name || p.id}</strong>
              <span className="muted">
                {p.version ? ` · ${p.version}` : ''}
                {p.isBuiltIn ? ' · built-in' : ''}
                {p.enabled === false ? ' · disabled' : ''}
                {typeof p.workerCount === 'number' ? ` · ${p.workerCount} workers` : ''}
              </span>
              {p.description ? <p className="muted">{p.description}</p> : null}
            </li>
          ))}
          {packs.length === 0 && <li className="muted">No packs</li>}
        </ul>
      )}
    </div>
  );
}
