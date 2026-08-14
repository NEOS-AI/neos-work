/**
 * Web Routines — cron schedules over workflows (v0.26).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type RoutineRow = {
  id: string;
  name: string;
  workflowId: string;
  schedule: string;
  timezone?: string;
  enabled: boolean;
};

type WfRow = { id: string; name: string };

export function Routines() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );
  const [items, setItems] = useState<RoutineRow[]>([]);
  const [workflows, setWorkflows] = useState<WfRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [schedule, setSchedule] = useState('0 9 * * *');
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [r, w] = await Promise.all([client.listRoutines(), client.listWorkflows()]);
      setItems(Array.isArray(r.data) ? r.data : []);
      const wfs = Array.isArray(w.data) ? w.data : [];
      setWorkflows(wfs.map((x) => ({ id: x.id, name: x.name })));
      setWorkflowId((cur) => cur || wfs[0]?.id || '');
    } catch (err) {
      setError(scrubError(err, 'Failed to load routines'));
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
      const res = await client.createRoutine({
        name,
        workflowId,
        schedule,
        timezone: 'UTC',
        enabled: true,
      });
      if (!res.ok) {
        setError(scrubError(res.error, 'Create failed'));
        return;
      }
      setName('');
      await reload();
    } catch (err) {
      setError(scrubError(err, 'Create failed'));
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (r: RoutineRow) => {
    const res = await client.updateRoutine(r.id, { enabled: !r.enabled });
    if (!res.ok) {
      setError(scrubError(res.error, 'Update failed'));
      return;
    }
    await reload();
  };

  const handleRun = async (id: string) => {
    const res = await client.runRoutineNow(id);
    if (!res.ok) {
      setError(scrubError(res.error, 'Run failed'));
      return;
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this routine?')) return;
    const res = await client.deleteRoutine(id);
    if (!res.ok) {
      setError(scrubError(res.error, 'Delete failed'));
      return;
    }
    await reload();
  };

  return (
    <div className="layout stack" data-testid="routines-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Routines</h1>
          <p className="muted">Scheduled workflow runs</p>
        </div>
        <WebNav current="/routines" />
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <form
        className="card stack"
        data-testid="routine-create-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        <input
          className="input"
          data-testid="routine-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
        />
        <select
          className="input"
          data-testid="routine-workflow"
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
        >
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          data-testid="routine-schedule"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          placeholder="cron"
        />
        <button type="submit" className="btn" data-testid="routine-create" disabled={creating}>
          {creating ? 'Creating…' : 'Create routine'}
        </button>
      </form>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul data-testid="routine-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((r) => (
            <li key={r.id} className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong data-testid={`routine-${r.id}`}>{r.name}</strong>
                <span className="muted">
                  {' '}
                  · {r.schedule}
                  {r.enabled ? '' : ' · off'}
                </span>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`routine-run-${r.id}`}
                  onClick={() => void handleRun(r.id)}
                >
                  Run
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`routine-toggle-${r.id}`}
                  onClick={() => void handleToggle(r)}
                >
                  {r.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`routine-delete-${r.id}`}
                  onClick={() => void handleDelete(r.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="muted">No routines</li>}
        </ul>
      )}
    </div>
  );
}
