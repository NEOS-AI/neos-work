import { useCallback, useEffect, useState } from 'react';

import { useEngine } from '../hooks/useEngine.js';
import type { MediaFileInfo } from '../lib/engine.js';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function Media() {
  const { client } = useEngine();
  const [files, setFiles] = useState<MediaFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MediaFileInfo | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    const res = await client.listMediaFiles(200);
    if (res.ok && res.data) setFiles(res.data);
    else setError((res as { error?: string }).error ?? 'Failed to load media');
    setLoading(false);
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (filename: string) => {
    if (!client) return;
    if (!window.confirm(`Delete ${filename}?`)) return;
    const res = await client.deleteMediaFile(filename);
    if (res.ok) {
      setFiles((prev) => prev.filter((f) => f.filename !== filename));
      if (selected?.filename === filename) {
        setSelected(null);
        setBlobUrl(null);
      }
    } else {
      setError((res as { error?: string }).error ?? 'Delete failed');
    }
  };

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      if (!client || !selected) {
        setBlobUrl(null);
        return;
      }
      try {
        const blob = await client.fetchMediaBlob(selected.filename);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch (err) {
        if (!cancelled) {
          setBlobUrl(null);
          setError(err instanceof Error ? err.message : 'Preview failed');
        }
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, selected]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Media</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            FileViewer for Media node outputs stored under ~/.neos-work/media
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : files.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center text-sm"
          style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}
        >
          No media files yet. Run a workflow with a Media node (image/audio).
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-1 space-y-2 max-h-[70vh] overflow-y-auto">
            {files.map((f) => (
              <div
                key={f.filename}
                className="flex items-stretch gap-1"
              >
                <button
                  type="button"
                  onClick={() => { setError(null); setSelected(f); }}
                  className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-left text-xs transition-colors"
                  style={{
                    borderColor: selected?.filename === f.filename ? '#3b82f6' : 'var(--border-primary)',
                    backgroundColor: selected?.filename === f.filename ? 'var(--bg-secondary)' : 'transparent',
                    color: 'var(--text-primary)',
                  }}
                >
                  <div className="font-medium truncate">{f.filename}</div>
                  <div style={{ color: 'var(--text-muted)' }}>
                    {f.kind} · {formatBytes(f.size)} · {new Date(f.createdAt).toLocaleString()}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(f.filename)}
                  className="shrink-0 rounded-lg border px-2 text-xs text-red-400"
                  style={{ borderColor: 'var(--border-primary)' }}
                  title="Delete file"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div
            className="md:col-span-2 min-h-[320px] rounded-xl border p-4 flex items-center justify-center"
            style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
          >
            {!selected && (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a file to preview</p>
            )}
            {selected && !blobUrl && (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading preview…</p>
            )}
            {selected && blobUrl && selected.kind === 'image' && (
              <img src={blobUrl} alt={selected.filename} className="max-h-[60vh] max-w-full rounded object-contain" />
            )}
            {selected && blobUrl && selected.kind === 'audio' && (
              <audio src={blobUrl} controls className="w-full" />
            )}
            {selected && blobUrl && selected.kind === 'other' && (
              <a href={blobUrl} download={selected.filename} className="text-sm text-blue-400 underline">
                Download {selected.filename}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
