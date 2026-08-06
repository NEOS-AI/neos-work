import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { downloadProjectZip } from '../lib/project-zip.js';
import { scrubError } from '../lib/scrub.js';

type Project = { id: string; name: string; baseDir?: string; entryFile?: string | null };

export function Projects() {
  const nav = useNavigate();
  const conn = loadConnection();
  const zipInputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  const client = useCallback(() => {
    return new WebApiClient(conn.serverUrl, conn.token);
  }, [conn.serverUrl, conn.token]);

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
      const res = await client().listProjects();
      setProjects((res.data as Project[]) ?? []);
    } catch (err) {
      setError(scrubError(err, 'Failed to load'));
      if (handleAuthError(err)) return;
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, nav, handleAuthError]);

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
        setCreateError(scrubError(res.error, 'Failed to create project'));
        return;
      }
      setNewName('');
      // Navigate into the new project
      nav(`/projects/${encodeURIComponent(res.data.id)}`);
    } catch (err) {
      if (handleAuthError(err)) return;
      setCreateError(scrubError(err, 'Failed to create project'));
    } finally {
      setCreating(false);
    }
  };

  const startRename = (p: Project) => {
    setActionError(null);
    setRenamingId(p.id);
    setRenameValue(p.name.replace(/[\0\r\n]+/g, ' ').slice(0, 200));
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
    setRenameBusy(false);
  };

  const handleRename = async (id: string) => {
    if (renameBusy) return;
    const name = renameValue;
    if (typeof name !== 'string' || /[\0\r\n]/.test(name) || !name.trim()) {
      setActionError('Project name is invalid');
      return;
    }
    const current = projects.find((p) => p.id === id);
    if (current && current.name.trim() === name.trim()) {
      cancelRename();
      return;
    }
    setRenameBusy(true);
    setActionError(null);
    try {
      const res = await client().updateProject(id, { name: name.trim() });
      if (!res.ok || !res.data) {
        setActionError(scrubError(res.error, 'Failed to rename project'));
        return;
      }
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, name: res.data!.name } : p)),
      );
      cancelRename();
    } catch (err) {
      if (handleAuthError(err)) return;
      setActionError(scrubError(err, 'Failed to rename project'));
    } finally {
      setRenameBusy(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (deletingId) return;
    const nameSafe = name.replace(/[\0\r\n]+/g, ' ').slice(0, 200) || id;
    if (!window.confirm(`Delete project “${nameSafe}”? This cannot be undone.`)) {
      return;
    }
    setDeletingId(id);
    setActionError(null);
    try {
      const res = await client().deleteProject(id);
      if (!res.ok) {
        setActionError(scrubError(res.error, 'Failed to delete project'));
        return;
      }
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (renamingId === id) cancelRename();
    } catch (err) {
      if (handleAuthError(err)) return;
      setActionError(scrubError(err, 'Failed to delete project'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleExportZip = async (id: string, name: string) => {
    if (zipBusy) return;
    setZipBusy(true);
    setZipError(null);
    try {
      const res = await downloadProjectZip(client(), id, name);
      if (!res.ok) {
        setZipError(res.error);
        return;
      }
    } catch (err) {
      if (handleAuthError(err)) return;
      setZipError(scrubError(err, 'Export failed'));
    } finally {
      setZipBusy(false);
    }
  };

  const handleImportZip = async (file: File | null) => {
    if (!file || zipBusy) return;
    if (
      !file.name.toLowerCase().endsWith('.zip')
      && file.type
      && !file.type.includes('zip')
    ) {
      setZipError('Choose a .zip project archive');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setZipError('Zip too large (max 50 MiB)');
      return;
    }
    setZipBusy(true);
    setZipError(null);
    try {
      const res = await client().importProjectZip(file);
      if (!res.ok || !res.data?.project?.id) {
        setZipError(scrubError(res.error, 'Import failed'));
        return;
      }
      await reload();
      nav(`/projects/${encodeURIComponent(res.data.project.id)}`);
    } catch (err) {
      if (handleAuthError(err)) return;
      setZipError(scrubError(err, 'Import failed'));
    } finally {
      setZipBusy(false);
      if (zipInputRef.current) zipInputRef.current.value = '';
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
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip"
          style={{ display: 'none' }}
          data-testid="project-import-zip-input"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            void handleImportZip(f);
          }}
        />
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="project-import-zip"
          disabled={zipBusy || creating}
          onClick={() => zipInputRef.current?.click()}
        >
          {zipBusy ? 'Zip…' : 'Import zip'}
        </button>
      </form>
      {createError && (
        <p className="err" role="alert" data-testid="project-create-error">
          {createError}
        </p>
      )}
      {zipError && (
        <p className="err" role="alert" data-testid="project-zip-error">
          {zipError}
        </p>
      )}

      {loading && <p className="muted">Loading…</p>}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {actionError && (
        <p className="err" role="alert" data-testid="project-action-error">
          {actionError}
        </p>
      )}
      {!loading && projects.length === 0 && !error && (
        <p className="muted">No projects yet. Create one above.</p>
      )}
      <ul className="list" data-testid="project-list">
        {projects.map((p) => (
          <li key={p.id}>
            {renamingId === p.id ? (
              <form
                className="row"
                style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                data-testid={`project-rename-form-${p.id}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleRename(p.id);
                }}
              >
                <input
                  className="input"
                  data-testid={`project-rename-input-${p.id}`}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  maxLength={200}
                  disabled={renameBusy}
                  autoFocus
                  autoComplete="off"
                  aria-label="Project name"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  style={{ flex: '1 1 160px', minWidth: 120 }}
                />
                <button
                  type="submit"
                  className="btn"
                  data-testid={`project-rename-save-${p.id}`}
                  disabled={renameBusy || !renameValue.trim()}
                >
                  {renameBusy ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`project-rename-cancel-${p.id}`}
                  disabled={renameBusy}
                  onClick={cancelRename}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Link to={`/projects/${encodeURIComponent(p.id)}`}>
                    <strong>{p.name}</strong>
                  </Link>
                  <div className="muted mono">{p.id}</div>
                  {p.entryFile && <div className="muted">entry: {p.entryFile}</div>}
                </div>
                <div className="row" style={{ flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    data-testid={`project-export-${p.id}`}
                    disabled={!!deletingId || renameBusy || zipBusy}
                    onClick={() => void handleExportZip(p.id, p.name)}
                  >
                    Export
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    data-testid={`project-rename-${p.id}`}
                    disabled={!!deletingId || renameBusy || zipBusy}
                    onClick={() => startRename(p)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    data-testid={`project-delete-${p.id}`}
                    disabled={!!deletingId || renameBusy || zipBusy}
                    style={{ color: 'var(--danger)' }}
                    onClick={() => void handleDelete(p.id, p.name)}
                  >
                    {deletingId === p.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
