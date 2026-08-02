import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (!conn.token) {
      nav('/');
      return;
    }
    const client = new WebApiClient(conn.serverUrl, conn.token);
    void client
      .listProjects()
      .then((res) => {
        setProjects((res.data as Project[]) ?? []);
      })
      .catch((err) => {
        const msg = err instanceof ApiError ? err.message : 'Failed to load';
        setError(msg);
        if (err instanceof ApiError && err.status === 401) {
          clearConnection();
          nav('/');
        }
      })
      .finally(() => setLoading(false));
  }, [conn.serverUrl, conn.token, nav]);

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
      {loading && <p className="muted">Loading…</p>}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {!loading && projects.length === 0 && !error && (
        <p className="muted">No projects yet. Create one with the desktop app or CLI.</p>
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
