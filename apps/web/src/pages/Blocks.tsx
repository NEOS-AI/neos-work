/**
 * Web Blocks — list + create custom prompt block + delete (v0.26).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type BlockRow = {
  id: string;
  name: string;
  domain: string;
  category?: string;
  description?: string;
  isBuiltIn?: boolean;
  implementationType?: string;
};

export function Blocks() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );
  const [items, setItems] = useState<BlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('general');
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);

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
      const res = await client.listBlocks();
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(scrubError(err, 'Failed to load blocks'));
      if (handleAuthError(err)) return;
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, handleAuthError, nav]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreate = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await client.createBlock({
        id,
        name,
        domain,
        implementationType: 'prompt',
        promptTemplate: prompt,
        description: name,
      });
      if (!res.ok) {
        setError(scrubError(res.error, 'Create failed'));
        return;
      }
      setId('');
      setName('');
      setPrompt('');
      await reload();
    } catch (err) {
      if (handleAuthError(err)) return;
      setError(scrubError(err, 'Create failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (blockId: string) => {
    if (!window.confirm('Delete this custom block?')) return;
    const res = await client.deleteBlock(blockId);
    if (!res.ok) {
      setError(scrubError(res.error, 'Delete failed'));
      return;
    }
    await reload();
  };

  return (
    <div className="layout stack" data-testid="blocks-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Blocks</h1>
          <p className="muted">Workflow blocks (create custom prompt blocks)</p>
        </div>
        <WebNav current="/blocks" />
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <form
        className="card stack"
        data-testid="block-create-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input
            className="input"
            data-testid="block-id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="id (a-z0-9_-)"
          />
          <input
            className="input"
            data-testid="block-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
          />
          <select
            className="input"
            data-testid="block-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          >
            <option value="general">general</option>
            <option value="coding">coding</option>
            <option value="finance">finance</option>
          </select>
        </div>
        <textarea
          className="input"
          data-testid="block-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Prompt template"
        />
        <button type="submit" className="btn" data-testid="block-create" disabled={saving}>
          {saving ? 'Creating…' : 'Create block'}
        </button>
      </form>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul data-testid="block-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((b) => (
            <li key={b.id} className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong data-testid={`block-${b.id}`}>{b.name}</strong>
                <span className="muted">
                  {' '}
                  · {b.id} · {b.domain}
                  {b.isBuiltIn ? ' · built-in' : ''}
                </span>
              </div>
              {!b.isBuiltIn && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`block-delete-${b.id}`}
                  onClick={() => void handleDelete(b.id)}
                >
                  Delete
                </button>
              )}
            </li>
          ))}
          {items.length === 0 && <li className="muted">No blocks</li>}
        </ul>
      )}
    </div>
  );
}
