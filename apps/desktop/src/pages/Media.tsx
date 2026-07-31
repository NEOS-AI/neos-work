import { useCallback, useEffect, useMemo, useState } from 'react';

import { useEngine } from '../hooks/useEngine.js';
import type { MediaFileInfo } from '../lib/engine.js';
import { formatBytes } from '../lib/format-bytes.js';
import { scrubDisplayText } from '../lib/format-duration.js';
import { formatAbsoluteTime, formatRelativeTime } from '../lib/format-relative-time.js';
import { formatListCount } from '../lib/list-count.js';
import { sortByDateDesc } from '../lib/list-sort.js';
import {
  loadMediaKindFilter,
  saveMediaKindFilter,
  type MediaKindFilter,
} from '../lib/media-prefs.js';
import { filterByKind, filterByTextMatch } from '../lib/workflow-list-filter.js';

export function Media() {
  const { client } = useEngine();
  const [files, setFiles] = useState<MediaFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MediaFileInfo | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<MediaKindFilter>(() => loadMediaKindFilter());
  const [search, setSearch] = useState('');

  const handleKindFilter = (kind: MediaKindFilter) => {
    setKindFilter(kind);
    saveMediaKindFilter(kind);
  };

  const visibleFiles = useMemo(() => {
    const byKind = filterByKind(files, kindFilter);
    // Haystack uses scrubbed fields so null-bytes do not poison search matching
    const matched = filterByTextMatch(byKind, search, (f) => {
      const name = scrubDisplayText(f.filename, { collapseLines: true, maxChars: 500 });
      const kind = scrubDisplayText(f.kind, { collapseLines: true, maxChars: 40 });
      return `${name} ${kind}`;
    });
    return sortByDateDesc(matched, (f) => f.createdAt);
  }, [files, kindFilter, search]);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setError(null);
    try {
      const res = await client.listMediaFiles(200);
      if (res.ok && res.data) setFiles(res.data);
      else {
        setFiles([]);
        setError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Failed to load media',
        );
      }
    } catch (err) {
      setFiles([]);
      const msg = err instanceof Error ? err.message : 'Failed to load media';
      setError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to load media',
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  // Escape: clear preview first, otherwise clear search (blob URL revoked by selected effect cleanup)
  useEffect(() => {
    if (!selected && !search) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (selected) {
        setSelected(null);
        return;
      }
      if (search) setSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, search]);

  const handleDelete = async (filename: string) => {
    if (!client) return;
    // Control-char / blank filenames never sent to delete API
    if (typeof filename !== 'string' || /[\0\r\n]/.test(filename) || !filename.trim()) {
      window.alert('Filename contains invalid control characters');
      return;
    }
    const fileId = filename.trim();
    const nameSafe =
      scrubDisplayText(fileId, { collapseLines: true, maxChars: 200 }) || 'file';
    if (!window.confirm(`Delete ${nameSafe}?`)) return;
    try {
      const res = await client.deleteMediaFile(fileId);
      if (res.ok) {
        setFiles((prev) => prev.filter((f) => f.filename !== filename && f.filename !== fileId));
        // Clear selection only; blob effect cleanup revokes the object URL
        if (selected?.filename === filename || selected?.filename === fileId) setSelected(null);
      } else {
        setError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Delete failed',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      setError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Delete failed',
      );
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
        const rawName = selected.filename;
        // Control-char / blank filenames never fetched (path injection defense)
        if (typeof rawName !== 'string' || /[\0\r\n]/.test(rawName) || !rawName.trim()) {
          if (!cancelled) {
            setBlobUrl(null);
            setError('Filename contains invalid control characters');
          }
          return;
        }
        const blob = await client.fetchMediaBlob(rawName.trim());
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch (err) {
        if (!cancelled) {
          setBlobUrl(null);
          const msg = err instanceof Error ? err.message : 'Preview failed';
          setError(
            scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Preview failed',
          );
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
        <div className="flex flex-wrap items-center gap-2">
          {files.length > 0 && (
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files…"
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{
                borderColor: 'var(--border-secondary)',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                minWidth: 160,
              }}
            />
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400">
          {scrubDisplayText(error, { collapseLines: true, maxChars: 300 }) || error}
        </p>
      )}

      {files.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(['all', 'image', 'audio', 'video', 'other'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => handleKindFilter(k)}
              className="rounded-lg px-2.5 py-1 text-xs font-medium capitalize"
              style={{
                backgroundColor: kindFilter === k ? '#3b82f6' : 'var(--bg-tertiary)',
                color: kindFilter === k ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {k}
            </button>
          ))}
          <span className="self-center text-xs" style={{ color: 'var(--text-muted)' }}>
            {formatListCount(visibleFiles.length, files.length)}
          </span>
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : files.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center text-sm"
          style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}
        >
          No media files yet. Run a workflow with a Media node (image/audio/video).
        </div>
      ) : visibleFiles.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No files match the current filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-1 space-y-2 max-h-[70vh] overflow-y-auto">
            {visibleFiles.map((f) => (
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
                  <div className="font-medium truncate">
                    {scrubDisplayText(f.filename, { collapseLines: true, maxChars: 200 }) || 'file'}
                  </div>
                  <div style={{ color: 'var(--text-muted)' }} title={formatAbsoluteTime(f.createdAt)}>
                    {scrubDisplayText(f.kind, { collapseLines: true, maxChars: 40 }) || 'other'}
                    {' · '}
                    {formatBytes(f.size)} · {formatRelativeTime(f.createdAt)}
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
              <img
                src={blobUrl}
                alt={scrubDisplayText(selected.filename, { collapseLines: true, maxChars: 200 }) || 'image'}
                className="max-h-[60vh] max-w-full rounded object-contain"
              />
            )}
            {selected && blobUrl && selected.kind === 'audio' && (
              <audio src={blobUrl} controls className="w-full" />
            )}
            {selected && blobUrl && selected.kind === 'other' && (
              <a
                href={blobUrl}
                download={
                  scrubDisplayText(selected.filename, { collapseLines: true, maxChars: 200 })
                    .replace(/[^\w.\-()+ ]+/g, '_')
                  || 'download'
                }
                className="text-sm text-blue-400 underline"
              >
                Download{' '}
                {scrubDisplayText(selected.filename, { collapseLines: true, maxChars: 200 }) || 'file'}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
