import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadConnection, saveConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';

export function Connect() {
  const nav = useNavigate();
  const initial = loadConnection();
  const [serverUrl, setServerUrl] = useState(initial.serverUrl);
  const [token, setToken] = useState(initial.token);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    setHealth(null);
    try {
      const client = new WebApiClient(serverUrl.trim(), token.trim());
      const h = await client.health();
      setHealth(`${h.status} · v${h.version ?? '?'} · uptime ${h.uptime ?? 0}s`);
      // Authenticated probe
      await client.listProjects();
      saveConnection({ serverUrl: serverUrl.trim(), token: token.trim(), remember });
      nav('/projects');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Connection failed';
      setError(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 300));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="layout">
      <div className="stack" style={{ maxWidth: 480 }}>
        <h1 style={{ margin: 0 }}>NEOS Work</h1>
        <p className="muted">
          Browser client (Task 12). Paste the daemon Bearer token from server logs
          (<code>NEOS_AUTH_TOKEN=…</code>).
        </p>
        <label className="stack">
          <span className="muted">Server URL</span>
          <input
            className="input"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://127.0.0.1:3000"
            data-testid="connect-url"
          />
        </label>
        <label className="stack">
          <span className="muted">Auth token</span>
          <input
            className="input mono"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Bearer token"
            data-testid="connect-token"
            autoComplete="off"
          />
        </label>
        <label className="row muted">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          Remember in this browser
        </label>
        {error && (
          <p className="err" role="alert">
            {error}
          </p>
        )}
        {health && <p className="muted">{health}</p>}
        <button
          type="button"
          className="btn"
          disabled={busy || !token.trim()}
          onClick={() => void onConnect()}
          data-testid="connect-submit"
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
