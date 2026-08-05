import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';

type Project = { id: string; name: string; baseDir?: string; entryFile?: string | null };

export function Projects() {
  const nav = useNavigate();
  const conn = loadConnection();
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const client = useCallback(() => {
    return new WebApiClient(conn.serverUrl, conn.token);
  }, [conn.serverUrl, conn.token]);

  const reload = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client().listProjects();
      setProjects((res.data as Project[]) ?? []);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load';
      setError(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 300));
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
    if (creating) return;
    const name = newName;
    if (typeof name !== 'string' || /[\0\r\n]/.test(name) || !name.trim()) {
      setCreateError('Project name is invalid');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await client().createProject({ name: name.trim() });
      if (!res.ok || !res.data?.id) {
        setCreateError(
          (typeof res.error === 'string' && res.error ? res.error : 'Failed to create project')
            .replace(/[\0\r\n]+/g, ' ')
            .slice(0, 300),
        );
        return;
      }
      setNewName('');
      // Navigate into the new project
      nav(`/projects/${encodeURIComponent(res.data.id)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
        return;
      }
      setCreateError(
        (err instanceof ApiError ? err.message : 'Failed to create project')
          .replace(/[\0\r\n]+/g, ' ')
          .slice(0, 300),
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="layout stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>Projects</h1>
          <p className="muted">Design projects on the daemon</p>
        </div>
        <div className="row">
          <Link to="/settings" className="btn btn-ghost">
            Settings
          </Link>
          <Link to="/" className="btn btn-ghost">
            Connection
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              clearConnection();
              nav('/');
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <form
        className="card row"
        style={{ alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}
        data-testid="project-create-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        <label className="stack" style={{ flex: '1 1 200px', minWidth: 160 }}>
          <span className="muted">New project</span>
          <input
            className="input"
            data-testid="project-create-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Landing page"
            maxLength={200}
            disabled={creating}
            autoComplete="off"
          />
        </label>
        <button
          type="submit"
          className="btn"
          data-testid="project-create-submit"
          disabled={creating || !newName.trim()}
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>
      {createError && (
        <p className="err" role="alert" data-testid="project-create-error">
          {createError}
        </p>
      )}

      {loading && <p className="muted">Loading…</p>}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {!loading && projects.length === 0 && !error && (
        <p className="muted">No projects yet. Create one above.</p>
      )}
      <ul className="list" data-testid="project-list">
        {projects.map((p) => (
          <li key={p.id}>
            <Link to={`/projects/${p.id}`}>
              <strong>{p.name}</strong>
            </Link>
            <div className="muted mono">{p.id}</div>
            {p.entryFile && <div className="muted">entry: {p.entryFile}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
