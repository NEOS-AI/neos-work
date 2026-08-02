/**
 * Web settings — List B: NEOS as MCP install snippets (shared @neos-work/ui-app).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { McpInstallPanel, type McpInstallInfo } from '@neos-work/ui-app';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';

export function Settings() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );

  const [hideToken, setHideToken] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<McpInstallInfo | null>(null);

  const load = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.getMcpInstallInfo({ includeToken: !hideToken });
      setInfo((res.data as McpInstallInfo) ?? null);
    } catch (err) {
      setInfo(null);
      const msg = err instanceof ApiError ? err.message : 'Failed to load MCP install info';
      setError(msg);
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
      }
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, hideToken, nav]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="layout stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>Settings</h1>
          <p className="muted">Daemon connection helpers</p>
        </div>
        <div className="row">
          <Link to="/projects" className="btn btn-ghost">
            Projects
          </Link>
          <Link to="/" className="btn btn-ghost">
            Connection
          </Link>
        </div>
      </div>

      <McpInstallPanel
        info={info}
        loading={loading}
        error={error}
        hideToken={hideToken}
        onHideTokenChange={setHideToken}
        onRefresh={() => void load()}
        showCodexActions={false}
        description="Install snippets for coding agents that connect to this daemon via neos mcp serve (stdio). Codex one-click requires the desktop app."
      />
    </div>
  );
}

export default Settings;
