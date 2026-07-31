import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';

export function ProjectDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const conn = loadConnection();
  const [name, setName] = useState('');
  const [files, setFiles] = useState<Array<{ path: string }>>([]);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const client = new WebApiClient(conn.serverUrl, conn.token);

  const load = useCallback(async () => {
    if (!conn.token || !id) {
      nav('/');
      return;
    }
    setError(null);
    try {
      const p = await client.getProject(id);
      setName((p.data as { name?: string })?.name ?? id);
      const f = await client.listFiles(id);
      const list = ((f.data as Array<{ path: string; type?: string }>) ?? []).filter(
        (x) => x.type !== 'directory',
      );
      setFiles(list);
      const entry =
        list.find((x) => x.path === 'index.html')?.path
        || list[0]?.path
        || null;
      if (entry) {
        const file = await client.readFile(id, entry);
        setOpenPath(entry);
        setContent((file.data as { content?: string })?.content ?? '');
        setDirty(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }, [conn.serverUrl, conn.token, id, nav]);

  useEffect(() => {
    void load();
  }, [load]);

  const openFile = async (path: string) => {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const file = await client.readFile(id, path);
      setOpenPath(path);
      setContent((file.data as { content?: string })?.content ?? '');
      setDirty(false);
      setStatus(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Read failed');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!id || !openPath) return;
    if (/\0/.test(content)) {
      setError('Content contains null bytes');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.writeFile(id, openPath, content);
      setDirty(false);
      setStatus('Saved');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="layout stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <Link to="/projects" className="muted">
            ← Projects
          </Link>
          <h1 style={{ margin: '0.25rem 0 0' }}>{name || id}</h1>
        </div>
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {status && <p className="muted">{status}</p>}
      <div className="row" style={{ alignItems: 'stretch' }}>
        <div className="card" style={{ minWidth: 180, flex: '0 0 200px' }}>
          <div className="muted" style={{ marginBottom: 8 }}>
            Files
          </div>
          <ul className="list">
            {files.map((f) => (
              <li key={f.path} style={{ padding: '0.4rem 0.5rem' }}>
                <button
                  type="button"
                  className="btn-ghost"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: openPath === f.path ? 'var(--accent)' : 'var(--text)',
                    cursor: 'pointer',
                    padding: 0,
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onClick={() => void openFile(f.path)}
                >
                  <span className="mono">{f.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="card stack" style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="mono muted">{openPath ?? 'No file'}</span>
            <button
              type="button"
              className="btn"
              disabled={!openPath || !dirty || busy}
              onClick={() => void save()}
              data-testid="file-save"
            >
              {busy ? '…' : 'Save'}
            </button>
          </div>
          <textarea
            className="input mono"
            style={{ minHeight: 360, resize: 'vertical' }}
            value={content}
            disabled={!openPath}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
              setStatus(null);
            }}
            data-testid="file-editor"
          />
        </div>
      </div>
    </div>
  );
}
