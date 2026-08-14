/**
 * Web Design System editor — DESIGN.md content (v0.26).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WebNav } from '../components/WebNav.js';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

export function DesignSystemEditor() {
  const { id: routeId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );
  const id =
    typeof routeId === 'string' && routeId.trim() && !/[\0\r\n]/.test(routeId) ? routeId.trim() : '';
  const [name, setName] = useState(id);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = content !== saved;

  const load = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    if (!id) {
      setError('Invalid design system id');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [list, body] = await Promise.all([
        client.listDesignSystems(),
        client.getDesignSystemContent(id),
      ]);
      const found = (list.data ?? []).find((d) => d.id === id);
      setName(found?.name || id);
      const raw = typeof body.data?.content === 'string' ? body.data.content : '';
      const safe = /\0/.test(raw) ? raw.replace(/\0/g, '') : raw;
      setContent(safe);
      setSaved(safe);
      if (!body.ok) setError(scrubError(body.error, 'Failed to load content'));
    } catch (err) {
      setError(scrubError(err, 'Failed to load'));
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
      }
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, id, nav]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const handleSave = async () => {
    if (!id || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await client.saveDesignSystemContent(id, content);
      if (!res.ok) {
        setError(scrubError(res.error, 'Save failed'));
        return;
      }
      setSaved(content);
    } catch (err) {
      setError(scrubError(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="layout stack" data-testid="ds-editor">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row">
          <button type="button" className="btn btn-ghost" data-testid="ds-editor-back" onClick={() => nav('/design-systems')}>
            ← Design systems
          </button>
          <h1 style={{ margin: 0, fontSize: '1.1rem' }}>{name}</h1>
          {dirty && <span className="muted">Unsaved</span>}
        </div>
        <div className="row">
          <button type="button" className="btn" data-testid="ds-editor-save" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <WebNav current="/design-systems" />
        </div>
      </div>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <textarea
          className="input"
          data-testid="ds-editor-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={24}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
      )}
    </div>
  );
}
