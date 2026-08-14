/**
 * Web Plugins — installed list + thin marketplace catalog (v0.25 Track A).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type PluginRow = {
  id: string;
  name: string;
  description?: string;
  version?: string;
  channel?: string;
};

type CatalogEntry = {
  id: string;
  name: string;
  description?: string;
  version: string;
  trust: string;
  packageUrl: string;
};

export function Plugins() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );

  const [plugins, setPlugins] = useState<PluginRow[]>([]);
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [catalogUrl, setCatalogUrl] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);

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
      const res = await client.listPlugins();
      setPlugins(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(scrubError(err, 'Failed to load plugins'));
      if (handleAuthError(err)) return;
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, handleAuthError, nav]);

  const loadCatalog = useCallback(async () => {
    setCatalogError(null);
    try {
      const res = await client.fetchMarketplaceCatalog();
      if (!res.ok) {
        setEntries([]);
        setCatalogError(scrubError(res.error, 'Catalog unavailable'));
        return;
      }
      setEntries(Array.isArray(res.data?.entries) ? res.data.entries : []);
    } catch (err) {
      setEntries([]);
      setCatalogError(scrubError(err, 'Catalog unavailable'));
    }
  }, [client]);

  useEffect(() => {
    void reload();
    void loadCatalog();
    void client.getMarketplaceCatalogUrl().then((res) => {
      if (res.ok && typeof res.data?.url === 'string') setCatalogUrl(res.data.url);
    }).catch(() => {});
  }, [reload, loadCatalog, client]);

  const handleInstall = async (id: string) => {
    setInstalling(id);
    setError(null);
    try {
      const res = await client.installMarketplaceEntry({ id });
      if (!res.ok) {
        setError(scrubError(res.error, 'Install failed'));
        return;
      }
      await reload();
    } catch (err) {
      if (handleAuthError(err)) return;
      setError(scrubError(err, 'Install failed'));
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="layout stack" data-testid="plugins-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Plugins</h1>
          <p className="muted">Installed plugins and remote catalog (thin web)</p>
        </div>
        <WebNav current="/plugins" />
      </div>

      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}

      <section className="card stack">
        <h2 style={{ margin: 0, fontSize: '1rem' }}>Installed</h2>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <ul data-testid="plugin-list" style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {plugins.map((p) => (
              <li key={p.id} data-testid={`plugin-${p.id}`}>
                <strong>{p.name || p.id}</strong>
                {p.version ? <span className="muted"> · {p.version}</span> : null}
                {p.channel ? <span className="muted"> · {p.channel}</span> : null}
                {p.description ? <div className="muted">{p.description}</div> : null}
              </li>
            ))}
            {plugins.length === 0 && <li className="muted">No plugins installed</li>}
          </ul>
        )}
      </section>

      <section className="card stack" data-testid="plugin-catalog">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Marketplace catalog</h2>
          <button type="button" className="btn btn-ghost" onClick={() => void loadCatalog()}>
            Refresh
          </button>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input
            className="input"
            data-testid="plugin-catalog-url"
            value={catalogUrl}
            onChange={(e) => setCatalogUrl(e.target.value)}
            placeholder="https://…/catalog.json"
            style={{ flex: 1, minWidth: 200 }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="plugin-catalog-url-save"
            disabled={urlBusy}
            onClick={() => {
              setUrlBusy(true);
              void client
                .setMarketplaceCatalogUrl(catalogUrl)
                .then((res) => {
                  if (!res.ok) setError(scrubError(res.error, 'Failed to save catalog URL'));
                  else void loadCatalog();
                })
                .finally(() => setUrlBusy(false));
            }}
          >
            Save URL
          </button>
        </div>
        {catalogError && <p className="muted">{catalogError}</p>}
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {entries.map((e) => (
            <li key={e.id} className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong>{e.name}</strong>
                <span className="muted">
                  {' '}
                  · {e.version} · {e.trust}
                </span>
                {e.description ? <div className="muted">{e.description}</div> : null}
              </div>
              <button
                type="button"
                className="btn"
                data-testid={`plugin-install-${e.id}`}
                disabled={installing === e.id}
                onClick={() => void handleInstall(e.id)}
              >
                {installing === e.id ? '…' : 'Install'}
              </button>
            </li>
          ))}
          {entries.length === 0 && !catalogError && <li className="muted">No catalog entries</li>}
        </ul>
        <p className="muted" style={{ fontSize: 12 }}>
          Catalog URL is stored on the daemon. Plugin pipeline run SSE stays on desktop.
        </p>
      </section>
    </div>
  );
}
