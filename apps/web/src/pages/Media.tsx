/**
 * Web Media — list generated files + generate image/audio/video (v0.23 dual-surface).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type MediaSurface = 'image' | 'audio' | 'video';

type MediaFileInfo = {
  filename: string;
  size: number;
  kind: 'image' | 'audio' | 'video' | 'other';
  mimeType?: string;
  createdAt?: string;
  urlPath?: string;
};

type MediaProviderInfo = {
  id: string;
  label: string;
  surfaces: string[];
  configured: boolean;
  isStub?: boolean;
};

function scrubText(raw: unknown, max = 300): string {
  if (raw == null) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  return s.replace(/[\0\r\n]+/g, ' ').slice(0, max).trim();
}

export function Media() {
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );

  const [files, setFiles] = useState<MediaFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [surface, setSurface] = useState<MediaSurface>('image');
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState('');
  const [providers, setProviders] = useState<MediaProviderInfo[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const pollCancelRef = useRef(false);

  const providersForSurface = useMemo(
    () =>
      providers.filter(
        (p) =>
          Array.isArray(p.surfaces)
          && p.surfaces.some((s) => String(s).toLowerCase() === surface),
      ),
    [providers, surface],
  );

  const load = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.listMediaFiles(200);
      if (res.ok && res.data) {
        setFiles(Array.isArray(res.data) ? res.data : []);
      } else {
        setFiles([]);
        setError(scrubError(res.error, 'Failed to load media'));
      }
    } catch (err) {
      setFiles([]);
      setError(scrubError(err, 'Failed to load media'));
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
      }
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, nav]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!conn.token) return;
    let cancelled = false;
    void client
      .listMediaProviders()
      .then((res) => {
        if (cancelled) return;
        if (res.ok && Array.isArray(res.data)) {
          setProviders(res.data as MediaProviderInfo[]);
        }
      })
      .catch(() => {
        /* optional — free-text provider */
      });
    return () => {
      cancelled = true;
    };
  }, [client, conn.token]);

  useEffect(() => {
    return () => {
      pollCancelRef.current = true;
    };
  }, []);

  const pollMediaJob = useCallback(
    async (jobId: string): Promise<{ filename?: string; error?: string }> => {
      const maxAttempts = 60;
      for (let i = 0; i < maxAttempts; i++) {
        if (pollCancelRef.current) return { error: 'Cancelled' };
        try {
          const job = await client.getMediaJob(jobId);
          if (!job.ok || !job.data) {
            return { error: scrubError(job.error, 'Job poll failed') };
          }
          const st = String(job.data.status || '').toLowerCase();
          setGenStatus(`Job ${jobId.slice(0, 8)}… · ${st || 'pending'}`);
          if (st === 'succeeded' || st === 'completed' || st === 'done') {
            return { filename: job.data.filename };
          }
          if (st === 'failed' || st === 'error' || st === 'cancelled') {
            return {
              error: scrubText(job.data.error, 300) || `Job ${st}`,
            };
          }
        } catch (err) {
          return { error: scrubError(err, 'Job poll failed') };
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      return { error: 'Job timed out' };
    },
    [client],
  );

  const handleGenerate = async () => {
    if (generating) return;
    const raw = prompt;
    if (typeof raw !== 'string' || !raw.trim()) {
      setError(surface === 'audio' ? 'Text is required' : 'Prompt is required');
      return;
    }
    if (surface === 'audio') {
      if (/\0/.test(raw)) {
        setError('Text contains invalid control characters');
        return;
      }
    } else if (/[\0\r\n]/.test(raw)) {
      setError('Prompt contains invalid control characters');
      return;
    }

    setGenerating(true);
    setError(null);
    setGenStatus('Generating…');
    pollCancelRef.current = false;
    try {
      const res = await client.generateMedia({
        surface,
        prompt: surface !== 'audio' ? raw.trim() : undefined,
        text: surface === 'audio' ? raw.trim() : undefined,
        provider: provider.trim() || undefined,
      });
      if (!res.ok) {
        setError(scrubError(res.error, 'Generate failed'));
        setGenStatus(null);
        return;
      }
      const data = res.data;
      if (data?.jobId) {
        setGenStatus(`Queued job ${data.jobId.slice(0, 8)}…`);
        const polled = await pollMediaJob(data.jobId);
        if (polled.error) {
          setError(polled.error);
          setGenStatus(null);
          return;
        }
        const name = polled.filename ? scrubText(polled.filename, 120) : null;
        setGenStatus(name ? `Generated ${name}` : 'Generated');
      } else {
        const name = data?.filename ? scrubText(data.filename, 120) : null;
        setGenStatus(name ? `Generated ${name}` : 'Generated');
      }
      setPrompt('');
      await load();
    } catch (err) {
      setError(scrubError(err, 'Generate failed'));
      setGenStatus(null);
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="layout stack" data-testid="media-page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ margin: 0 }}>Media</h1>
          <p className="muted">Generate image / audio / video on the daemon</p>
        </div>
        <div className="row">
          <Link to="/projects" className="btn btn-ghost" data-testid="media-nav-projects">
            Projects
          </Link>
          <Link to="/workflows" className="btn btn-ghost" data-testid="media-nav-workflows">
            Workflows
          </Link>
          <Link to="/settings" className="btn btn-ghost" data-testid="media-nav-settings">
            Settings
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void load()}
            data-testid="media-refresh"
          >
            Refresh
          </button>
        </div>
      </div>

      <form
        className="card stack"
        data-testid="media-generate-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleGenerate();
        }}
      >
        <div className="row" style={{ gap: 8 }}>
          <span className="muted" style={{ fontWeight: 600 }}>
            Generate
          </span>
          {(['image', 'audio', 'video'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="btn btn-ghost"
              style={{
                backgroundColor: surface === s ? 'var(--accent)' : undefined,
                color: surface === s ? '#fff' : undefined,
                textTransform: 'capitalize',
              }}
              onClick={() => setSurface(s)}
              data-testid={`media-surface-${s}`}
              disabled={generating}
            >
              {s}
            </button>
          ))}
        </div>
        <textarea
          className="input"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            surface === 'audio'
              ? 'Text to speak…'
              : surface === 'video'
                ? 'Video prompt…'
                : 'Image prompt…'
          }
          data-testid="media-generate-prompt"
          disabled={generating}
          style={{ resize: 'vertical' }}
        />
        <div className="row">
          {providersForSurface.length > 0 ? (
            <select
              className="input"
              style={{ width: 'auto', minWidth: 160 }}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              data-testid="media-generate-provider"
              disabled={generating}
            >
              <option value="">Default provider</option>
              {providersForSurface.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.configured && !p.isStub}>
                  {scrubText(p.label || p.id, 60) || p.id}
                  {!p.configured && !p.isStub ? ' (not configured)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              className="input"
              style={{ width: 'auto', minWidth: 160 }}
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              placeholder="Provider (optional)"
              data-testid="media-generate-provider"
              disabled={generating}
              autoComplete="off"
            />
          )}
          <button
            type="submit"
            className="btn"
            disabled={generating || !prompt.trim()}
            data-testid="media-generate-submit"
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {genStatus && (
          <p className="muted" data-testid="media-generate-status" style={{ margin: 0 }}>
            {genStatus}
          </p>
        )}
      </form>

      {error && (
        <p className="err" role="alert" data-testid="media-error">
          {error}
        </p>
      )}

      <section className="card stack" data-testid="media-file-list">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Files</h2>
          {!loading && (
            <span className="muted mono" style={{ fontSize: 12 }}>
              {files.length} file{files.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {loading && <p className="muted">Loading…</p>}
        {!loading && files.length === 0 && (
          <p className="muted">No media files yet. Generate one above.</p>
        )}
        {!loading && files.length > 0 && (
          <ul className="list" style={{ margin: 0 }}>
            {files.map((f) => {
              const name = scrubText(f.filename, 200) || 'file';
              const kind = scrubText(f.kind, 40) || 'other';
              const href = client.mediaFileUrl(f.filename);
              return (
                <li key={f.filename} data-testid={`media-file-${f.filename}`}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div className="stack" style={{ gap: 2 }}>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="mono"
                          style={{ fontSize: 13 }}
                        >
                          {name}
                        </a>
                      ) : (
                        <span className="mono" style={{ fontSize: 13 }}>
                          {name}
                        </span>
                      )}
                      <span className="muted" style={{ fontSize: 12 }}>
                        {kind}
                        {typeof f.size === 'number' ? ` · ${f.size} B` : ''}
                        {f.createdAt ? ` · ${scrubText(f.createdAt, 40)}` : ''}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export default Media;
