/**
 * Web settings — MCP install, API keys (verify/save), collab bus status (ops).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  isCanvasOverlayEnabled,
  writeCanvasOverlayPref,
} from '@neos-work/design-editor';
import { McpInstallPanel, type McpInstallInfo } from '@neos-work/ui-app';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';

type VerifyState = 'idle' | 'checking' | 'valid' | 'invalid' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const API_KEY_ROWS: Array<{
  label: string;
  settingKey: string;
  /** Provider id for POST /api/settings/verify-key (null = save only). */
  verifyProvider: 'anthropic' | 'google' | null;
  placeholder: string;
}> = [
  {
    label: 'Anthropic',
    settingKey: 'ANTHROPIC_API_KEY',
    verifyProvider: 'anthropic',
    placeholder: 'sk-ant-…',
  },
  {
    label: 'Google',
    settingKey: 'GOOGLE_API_KEY',
    verifyProvider: 'google',
    placeholder: 'AIza…',
  },
];

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

  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({});
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [canvasOverlay, setCanvasOverlay] = useState(() => isCanvasOverlayEnabled());
  const [verifyState, setVerifyState] = useState<Record<string, VerifyState>>({});
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({});

  const [collabStatus, setCollabStatus] = useState<{
    bus?: string;
    nodeId?: string;
    ready?: boolean;
    detail?: string | null;
    presence?: { kind?: string; ready?: boolean; detail?: string | null };
  } | null>(null);
  const [collabError, setCollabError] = useState<string | null>(null);
  const [collabLoading, setCollabLoading] = useState(false);

  const loadMcp = useCallback(async () => {
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

  const loadSettings = useCallback(async () => {
    if (!conn.token) return;
    setSettingsError(null);
    try {
      const res = await client.getSettings();
      if (!res.ok) {
        setSettingsError(res.error || 'Failed to load settings');
        setSettingsMap({});
        return;
      }
      setSettingsMap(res.data && typeof res.data === 'object' ? res.data : {});
    } catch (err) {
      setSettingsMap({});
      setSettingsError(err instanceof ApiError ? err.message : 'Failed to load settings');
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
      }
    }
  }, [client, conn.token, nav]);

  const loadCollabStatus = useCallback(async () => {
    if (!conn.token) return;
    setCollabLoading(true);
    setCollabError(null);
    try {
      const res = await client.getCollabStatus();
      if (!res.ok) {
        setCollabStatus(null);
        setCollabError(res.error || 'Failed to load collab status');
        return;
      }
      setCollabStatus(res.data ?? null);
    } catch (err) {
      setCollabStatus(null);
      setCollabError(err instanceof ApiError ? err.message : 'Failed to load collab status');
    } finally {
      setCollabLoading(false);
    }
  }, [client, conn.token]);

  useEffect(() => {
    void loadMcp();
  }, [loadMcp]);

  useEffect(() => {
    void loadSettings();
    void loadCollabStatus();
  }, [loadSettings, loadCollabStatus]);

  const handleVerify = async (settingKey: string, provider: 'anthropic' | 'google') => {
    const raw = keyDrafts[settingKey] ?? '';
    if (/[\0\r\n]/.test(raw)) {
      setVerifyState((s) => ({ ...s, [settingKey]: 'invalid' }));
      return;
    }
    const key = raw.trim();
    if (!key) return;
    setVerifyState((s) => ({ ...s, [settingKey]: 'checking' }));
    try {
      const res = await client.verifyApiKey(provider, key);
      if (!res.ok) {
        setVerifyState((s) => ({ ...s, [settingKey]: 'error' }));
      } else {
        setVerifyState((s) => ({
          ...s,
          [settingKey]: res.data?.valid ? 'valid' : 'invalid',
        }));
      }
    } catch {
      setVerifyState((s) => ({ ...s, [settingKey]: 'error' }));
    }
    window.setTimeout(() => {
      setVerifyState((s) => ({ ...s, [settingKey]: 'idle' }));
    }, 3500);
  };

  const handleSaveKey = async (settingKey: string) => {
    const raw = keyDrafts[settingKey] ?? '';
    if (/[\0\r\n]/.test(raw)) {
      setSaveState((s) => ({ ...s, [settingKey]: 'error' }));
      return;
    }
    const value = raw.trim();
    if (!value) return;
    setSaveState((s) => ({ ...s, [settingKey]: 'saving' }));
    try {
      const res = await client.saveSetting(settingKey, value);
      if (!res.ok) {
        setSaveState((s) => ({ ...s, [settingKey]: 'error' }));
        setSettingsError(res.error || 'Save failed');
        return;
      }
      setSaveState((s) => ({ ...s, [settingKey]: 'saved' }));
      setKeyDrafts((d) => ({ ...d, [settingKey]: '' }));
      await loadSettings();
    } catch (err) {
      setSaveState((s) => ({ ...s, [settingKey]: 'error' }));
      setSettingsError(err instanceof ApiError ? err.message : 'Save failed');
    }
    window.setTimeout(() => {
      setSaveState((s) => ({ ...s, [settingKey]: 'idle' }));
    }, 2500);
  };

  const handleClearKey = async (settingKey: string) => {
    setSaveState((s) => ({ ...s, [settingKey]: 'saving' }));
    try {
      const res = await client.saveSetting(settingKey, '');
      if (!res.ok) {
        setSaveState((s) => ({ ...s, [settingKey]: 'error' }));
        setSettingsError(res.error || 'Clear failed');
        return;
      }
      setKeyDrafts((d) => ({ ...d, [settingKey]: '' }));
      await loadSettings();
      setSaveState((s) => ({ ...s, [settingKey]: 'saved' }));
    } catch (err) {
      setSaveState((s) => ({ ...s, [settingKey]: 'error' }));
      setSettingsError(err instanceof ApiError ? err.message : 'Clear failed');
    }
    window.setTimeout(() => {
      setSaveState((s) => ({ ...s, [settingKey]: 'idle' }));
    }, 2500);
  };

  return (
    <div className="layout stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>Settings</h1>
          <p className="muted">Daemon connection, API keys, collab ops</p>
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

      <section className="card stack" data-testid="api-keys-section">
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>API keys</h2>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Keys are stored on the daemon (masked in the list). Verify checks the provider without
            saving; Save persists to settings.
          </p>
        </div>
        {settingsError && (
          <p className="err" role="alert">
            {settingsError}
          </p>
        )}
        {API_KEY_ROWS.map((row) => {
          const stored = settingsMap[row.settingKey];
          const hasStored = typeof stored === 'string' && stored.length > 0;
          const vState = verifyState[row.settingKey] ?? 'idle';
          const sState = saveState[row.settingKey] ?? 'idle';
          return (
            <div
              key={row.settingKey}
              className="stack"
              style={{ gap: 6 }}
              data-testid={`api-key-row-${row.settingKey}`}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <label className="muted" htmlFor={`key-${row.settingKey}`}>
                  {row.label}{' '}
                  <span className="mono" style={{ fontSize: 11 }}>
                    ({row.settingKey})
                  </span>
                </label>
                {hasStored && (
                  <span className="muted mono" data-testid={`api-key-masked-${row.settingKey}`}>
                    saved: {stored}
                  </span>
                )}
              </div>
              <input
                id={`key-${row.settingKey}`}
                className="input mono"
                type="password"
                autoComplete="off"
                placeholder={hasStored ? 'Enter new key to replace…' : row.placeholder}
                value={keyDrafts[row.settingKey] ?? ''}
                onChange={(e) =>
                  setKeyDrafts((d) => ({ ...d, [row.settingKey]: e.target.value }))
                }
                data-testid={`api-key-input-${row.settingKey}`}
              />
              <div className="row">
                {row.verifyProvider && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!(keyDrafts[row.settingKey] ?? '').trim() || vState === 'checking'}
                    onClick={() => void handleVerify(row.settingKey, row.verifyProvider!)}
                    data-testid={`api-key-verify-${row.settingKey}`}
                  >
                    {vState === 'checking'
                      ? 'Verifying…'
                      : vState === 'valid'
                        ? 'Valid ✓'
                        : vState === 'invalid'
                          ? 'Invalid'
                          : vState === 'error'
                            ? 'Error'
                            : 'Verify'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  disabled={!(keyDrafts[row.settingKey] ?? '').trim() || sState === 'saving'}
                  onClick={() => void handleSaveKey(row.settingKey)}
                  data-testid={`api-key-save-${row.settingKey}`}
                >
                  {sState === 'saving' ? 'Saving…' : sState === 'saved' ? 'Saved' : 'Save'}
                </button>
                {hasStored && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={sState === 'saving'}
                    onClick={() => void handleClearKey(row.settingKey)}
                    data-testid={`api-key-clear-${row.settingKey}`}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="card stack" data-testid="editor-prefs-section">
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Design Editor</h2>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Local preferences for this browser (not stored on the daemon).
          </p>
        </div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div>Canvas overlay</div>
            <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: 12 }}>
              Move, resize, align, and z-order on HTML Preview (default on). Env{' '}
              <code className="mono">VITE_NEOS_CANVAS_OVERLAY=0</code> forces off.
            </p>
          </div>
          <button
            type="button"
            className="btn"
            role="switch"
            aria-checked={canvasOverlay}
            data-testid="settings-canvas-overlay"
            onClick={() => {
              const next = !canvasOverlay;
              writeCanvasOverlayPref(next);
              setCanvasOverlay(next);
            }}
          >
            {canvasOverlay ? 'On' : 'Off'}
          </button>
        </div>
      </section>

      <section className="card stack" data-testid="dual-surface-badge">
        <div>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Desktop-only surfaces</h2>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            This browser client is the Design Project loop (editor, collab, comments, zip, runs).
            Full product surfaces stay on the Tauri app.
          </p>
        </div>
        <ul className="muted" style={{ margin: 0, paddingLeft: '1.2rem', fontSize: 13 }}>
          <li>
            <strong>Plugins / marketplace</strong> — remote catalog install, trust tiers (desktop
            Plugins page)
          </li>
          <li>Workflow editor · Domain packs · Media studio · Sessions · Memory UI</li>
        </ul>
        <p className="muted mono" style={{ margin: 0, fontSize: 11 }}>
          Policy: docs/reference/dual-surface.md (Q25 · Q29)
        </p>
      </section>

      <section className="card stack" data-testid="collab-status-section">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1rem' }}>Collab status</h2>
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              Multi-replica bus and presence registry (no secrets).
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={collabLoading}
            onClick={() => void loadCollabStatus()}
            data-testid="collab-status-refresh"
          >
            {collabLoading ? '…' : 'Refresh'}
          </button>
        </div>
        {collabError && (
          <p className="err" role="alert">
            {collabError}
          </p>
        )}
        {collabStatus && (
          <dl
            className="stack mono"
            style={{ fontSize: 12, gap: 4, margin: 0 }}
            data-testid="collab-status-body"
          >
            <div className="row" style={{ gap: 8 }}>
              <dt className="muted" style={{ minWidth: 72 }}>
                bus
              </dt>
              <dd style={{ margin: 0 }} data-testid="collab-status-bus">
                {collabStatus.bus ?? '—'}
                {typeof collabStatus.ready === 'boolean'
                  ? collabStatus.ready
                    ? ' · ready'
                    : ' · not ready'
                  : ''}
              </dd>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <dt className="muted" style={{ minWidth: 72 }}>
                nodeId
              </dt>
              <dd style={{ margin: 0 }} data-testid="collab-status-node">
                {collabStatus.nodeId ?? '—'}
              </dd>
            </div>
            {collabStatus.detail != null && collabStatus.detail !== '' && (
              <div className="row" style={{ gap: 8 }}>
                <dt className="muted" style={{ minWidth: 72 }}>
                  detail
                </dt>
                <dd style={{ margin: 0 }}>{collabStatus.detail}</dd>
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <dt className="muted" style={{ minWidth: 72 }}>
                presence
              </dt>
              <dd style={{ margin: 0 }} data-testid="collab-status-presence">
                {collabStatus.presence?.kind ?? '—'}
                {typeof collabStatus.presence?.ready === 'boolean'
                  ? collabStatus.presence.ready
                    ? ' · ready'
                    : ' · not ready'
                  : ''}
              </dd>
            </div>
            {collabStatus.presence?.detail != null && collabStatus.presence.detail !== '' && (
              <div className="row" style={{ gap: 8 }}>
                <dt className="muted" style={{ minWidth: 72 }}>
                  p.detail
                </dt>
                <dd style={{ margin: 0 }}>{collabStatus.presence.detail}</dd>
              </div>
            )}
          </dl>
        )}
        {!collabStatus && !collabError && !collabLoading && (
          <p className="muted">No status loaded.</p>
        )}
      </section>

      <McpInstallPanel
        info={info}
        loading={loading}
        error={error}
        hideToken={hideToken}
        onHideTokenChange={setHideToken}
        onRefresh={() => void loadMcp()}
        showCodexActions={false}
        description="Install snippets for coding agents that connect to this daemon via neos mcp serve (stdio). Codex one-click requires the desktop app."
      />
    </div>
  );
}

export default Settings;
