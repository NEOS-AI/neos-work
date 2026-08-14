/**
 * Web Memory — list / create / edit / toggle / delete (v0.25 Track A).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type MemoryType = 'user' | 'session' | 'skill' | 'reference';

type MemoryRow = {
  id: string;
  name: string;
  type: MemoryType | string;
  enabled: boolean;
  content: string;
};

export function Memory() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );

  const [items, setItems] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<MemoryType>('user');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
      const res = await client.listMemories();
      setItems(Array.isArray(res.data) ? (res.data as MemoryRow[]) : []);
    } catch (err) {
      setError(scrubError(err, 'Failed to load memory'));
      if (handleAuthError(err)) return;
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, handleAuthError, nav]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const resetForm = () => {
    setName('');
    setType('user');
    setContent('');
    setEditingId(null);
  };

  const handleSave = async () => {
    if (saving) return;
    if (/[\0\r\n]/.test(name) || !name.trim() || /\0/.test(content) || !content.trim()) {
      setError('Name and content are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = editingId
        ? await client.updateMemory(editingId, { name: name.trim(), type, content: content.trim() })
        : await client.createMemory({ name: name.trim(), type, content: content.trim() });
      if (!res.ok) {
        setError(scrubError(res.error, 'Save failed'));
        return;
      }
      resetForm();
      await reload();
    } catch (err) {
      if (handleAuthError(err)) return;
      setError(scrubError(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id: string) => {
    const res = await client.toggleMemory(id);
    if (!res.ok) {
      setError(scrubError(res.error, 'Toggle failed'));
      return;
    }
    await reload();
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this memory?')) return;
    const res = await client.deleteMemory(id);
    if (!res.ok) {
      setError(scrubError(res.error, 'Delete failed'));
      return;
    }
    if (editingId === id) resetForm();
    await reload();
  };

  return (
    <div className="layout stack" data-testid="memory-page">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Memory</h1>
          <p className="muted">Persistent context the agent can read</p>
        </div>
        <WebNav current="/memory" />
      </div>

      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}

      <form
        className="card stack"
        data-testid="memory-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <input
          className="input"
          data-testid="memory-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
        />
        <select
          className="input"
          data-testid="memory-type"
          value={type}
          onChange={(e) => setType(e.target.value as MemoryType)}
        >
          <option value="user">user</option>
          <option value="session">session</option>
          <option value="skill">skill</option>
          <option value="reference">reference</option>
        </select>
        <textarea
          className="input"
          data-testid="memory-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          placeholder="Markdown content"
        />
        <div className="row">
          <button type="submit" className="btn" data-testid="memory-save" disabled={saving}>
            {saving ? 'Saving…' : editingId ? 'Update' : 'Create'}
          </button>
          {editingId && (
            <button type="button" className="btn btn-ghost" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="list" data-testid="memory-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {items.map((item) => (
            <li key={item.id} className="card row" style={{ justifyContent: 'space-between' }}>
              <div>
                <strong data-testid={`memory-item-${item.id}`}>{item.name}</strong>
                <span className="muted" style={{ marginLeft: 8 }}>
                  {item.type}
                  {item.enabled ? '' : ' · off'}
                </span>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`memory-edit-${item.id}`}
                  onClick={() => {
                    setEditingId(item.id);
                    setName(item.name);
                    setType((item.type as MemoryType) || 'user');
                    setContent(item.content);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`memory-toggle-${item.id}`}
                  onClick={() => void handleToggle(item.id)}
                >
                  {item.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  data-testid={`memory-delete-${item.id}`}
                  onClick={() => void handleDelete(item.id)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="muted">No memories yet</li>}
        </ul>
      )}
    </div>
  );
}
