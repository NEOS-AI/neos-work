/**
 * Web Skills — list / scan / toggle / delete (v0.26).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type SkillRow = {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  category?: string;
  version?: string | null;
  source?: string;
};

export function Skills() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );
  const [items, setItems] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.listSkills();
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(scrubError(err, 'Failed to load skills'));
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

  const handleScan = async () => {
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await client.scanSkills();
      if (!res.ok) {
        setError(scrubError(res.error, 'Scan failed'));
        return;
      }
      setScanMsg(`Scanned ${res.data?.scanned ?? 0} · total ${res.data?.total ?? 0}`);
      await reload();
    } catch (err) {
      setError(scrubError(err, 'Scan failed'));
    } finally {
      setScanning(false);
    }
  };

  const handleToggle = async (s: SkillRow) => {
    const res = await client.toggleSkill(s.id, !s.enabled);
    if (!res.ok) {
      setError(scrubError(res.error, 'Toggle failed'));
      return;
    }
    await reload();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this skill?')) return;
    const res = await client.deleteSkill(id);
    if (!res.ok) {
      setError(scrubError(res.error, 'Delete failed'));
      return;
    }
    await reload();
  };

  return (
    <div className="layout stack" data-testid="skills-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Skills</h1>
          <p className="muted">Bundled and installed SKILL.md packages</p>
        </div>
        <WebNav current="/skills" />
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn" data-testid="skills-scan" disabled={scanning} onClick={() => void handleScan()}>
          {scanning ? 'Scanning…' : 'Scan skills'}
        </button>
        {scanMsg && <span className="muted">{scanMsg}</span>}
      </div>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul data-testid="skill-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((s) => (
            <li key={s.id} className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong data-testid={`skill-${s.id}`}>{s.name}</strong>
                <span className="muted">
                  {s.category ? ` · ${s.category}` : ''}
                  {s.enabled ? '' : ' · off'}
                </span>
                {s.description ? <p className="muted">{s.description}</p> : null}
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`skill-toggle-${s.id}`}
                  onClick={() => void handleToggle(s)}
                >
                  {s.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`skill-delete-${s.id}`}
                  onClick={() => void handleDelete(s.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="muted">No skills</li>}
        </ul>
      )}
    </div>
  );
}
