import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';
import type { DesignProject } from '../lib/engine.js';
import { safeEntityId, scrubDisplayText } from '../lib/format-duration.js';
import { formatAbsoluteTime, formatRelativeTime } from '../lib/format-relative-time.js';
import { formatListCount } from '../lib/list-count.js';
import { sortByDateDesc } from '../lib/list-sort.js';
import { isTauri, pickFolder } from '../lib/tauri.js';
import { filterBySearchText } from '../lib/workflow-list-filter.js';

export function Projects() {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<DesignProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [importBaseDir, setImportBaseDir] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const canNativeFolderPick = isTauri();

  const closeModal = useCallback(() => {
    setShowModal(false);
    setNewName('');
    setImportBaseDir('');
    setCreating(false);
    setCreateError(null);
  }, []);

  useEffect(() => {
    if (!showModal && !search) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (showModal) {
        closeModal();
        return;
      }
      if (search) setSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showModal, search, closeModal]);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setPageError(null);
    try {
      const res = await client.listProjects();
      if (res.ok && res.data) {
        setProjects(res.data);
      } else {
        setProjects([]);
        setPageError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || t('project.loadFailed'),
        );
      }
    } catch (err) {
      setProjects([]);
      const msg = err instanceof Error ? err.message : t('project.loadFailed');
      setPageError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || t('project.loadFailed'),
      );
    } finally {
      setLoading(false);
    }
  }, [client, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const list = filterBySearchText(projects, search);
    return sortByDateDesc(list, (p) => p.updatedAt);
  }, [projects, search]);

  const handleBrowseFolder = async () => {
    setCreateError(null);
    setPickingFolder(true);
    try {
      const selected = await pickFolder({ title: t('project.pickFolderTitle') });
      if (selected) {
        setImportBaseDir(selected);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('project.pickFolderFailed');
      setCreateError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || t('project.pickFolderFailed'),
      );
    } finally {
      setPickingFolder(false);
    }
  };

  const handleCreate = async () => {
    if (!client) return;
    if (/[\0\r\n]/.test(newName)) {
      setCreateError(t('project.invalidName'));
      return;
    }
    if (importBaseDir && /[\0\r\n]/.test(importBaseDir)) {
      setCreateError(t('project.invalidBaseDir'));
      return;
    }
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const baseDir = importBaseDir.trim() || undefined;
      let importToken: string | undefined;
      if (baseDir) {
        const tok = await client.createImportToken(baseDir);
        if (!tok.ok || !tok.data?.token) {
          setCreateError(
            scrubDisplayText(tok.error, { collapseLines: true, maxChars: 300 })
              || t('project.importTokenFailed'),
          );
          return;
        }
        importToken = tok.data.token;
      }
      const res = await client.createProject({
        name: newName.trim(),
        baseDir,
        importToken,
      });
      if (res.ok && res.data) {
        closeModal();
        navigate(`/projects/${res.data.id}`);
      } else {
        setCreateError(
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
            || t('project.createFailed'),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('project.createFailed');
      setCreateError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || t('project.createFailed'),
      );
    } finally {
      setCreating(false);
    }
  };


  const handleExportZip = useCallback(
    async (id: string, name: string) => {
      if (!client) return;
      const entityId = safeEntityId(id);
      if (!entityId) {
        setZipError(t('project.invalidId'));
        return;
      }
      setZipBusy(true);
      setZipError(null);
      try {
        const res = await client.exportProjectZip(entityId);
        if (!res.ok) {
          setZipError(
            scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
              || t('project.exportFailed'),
          );
          return;
        }
        const url = URL.createObjectURL(res.blob);
        const a = document.createElement('a');
        const safe =
          scrubDisplayText(name, { collapseLines: true, maxChars: 60 })
            ?.replace(/[^a-z0-9_-]+/gi, '_')
          || entityId.slice(0, 8);
        a.href = url;
        a.download = `${safe}.neos-project.zip`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('project.exportFailed');
        setZipError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
      } finally {
        setZipBusy(false);
      }
    },
    [client, t],
  );

  const handleImportZip = useCallback(
    async (file: File | null) => {
      if (!client || !file) return;
      if (!file.name.toLowerCase().endsWith('.zip') && file.type && !file.type.includes('zip')) {
        setZipError(t('project.importZipInvalid'));
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        setZipError(t('project.importZipTooLarge'));
        return;
      }
      setZipBusy(true);
      setZipError(null);
      try {
        const res = await client.importProjectZip(file);
        if (!res.ok || !res.data?.project) {
          setZipError(
            scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
              || t('project.importZipFailed'),
          );
          return;
        }
        await load();
        navigate(`/projects/${res.data.project.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('project.importZipFailed');
        setZipError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || msg);
      } finally {
        setZipBusy(false);
        if (zipInputRef.current) zipInputRef.current.value = '';
      }
    },
    [client, t, load, navigate],
  );

  const handleDelete = async (id: string, name: string) => {
    if (!client) return;
    const entityId = safeEntityId(id);
    if (!entityId) {
      window.alert(t('project.invalidId'));
      return;
    }
    const nameSafe =
      scrubDisplayText(name, { collapseLines: true, maxChars: 200 }) || entityId;
    if (!window.confirm(t('project.confirmDelete', { name: nameSafe }))) return;
    try {
      const res = await client.deleteProject(entityId);
      if (res.ok) {
        setPageError(null);
        setProjects((prev) => prev.filter((p) => p.id !== id && p.id !== entityId));
      } else {
        setPageError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || t('project.deleteFailed'),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('project.deleteFailed');
      setPageError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || t('project.deleteFailed'),
      );
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('project.title')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            {t('project.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            data-testid="project-zip-input"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void handleImportZip(f);
            }}
          />
          <button
            type="button"
            disabled={zipBusy}
            data-testid="project-import-zip"
            onClick={() => zipInputRef.current?.click()}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
          >
            {zipBusy ? t('common.loading') : t('project.importZip')}
          </button>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: 'var(--accent, #6366f1)' }}
          >
            {t('project.new')}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('project.searchPlaceholder')}
          className="w-full max-w-sm rounded-lg border px-3 py-2 text-sm"
          style={{
            borderColor: 'var(--border-primary)',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
          }}
          aria-label={t('project.searchPlaceholder')}
        />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {formatListCount(filtered.length, projects.length)}
        </span>
      </div>

      {pageError && (
        <div
          role="alert"
          className="rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-300"
        >
          {pageError}
        </div>
      )}
      {zipError && (
        <div
          role="alert"
          data-testid="project-zip-error"
          className="rounded-lg border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-300"
        >
          {zipError}
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('common.loading')}
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('project.empty')}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border p-4 transition-colors"
              style={{
                borderColor: 'var(--border-primary)',
                backgroundColor: 'var(--bg-secondary)',
              }}
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {scrubDisplayText(p.name, { collapseLines: true, maxChars: 120 }) || p.id}
                  </h2>
                  {p.entryFile && (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--bg-tertiary) 90%, transparent)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {scrubDisplayText(p.entryFile, { collapseLines: true, maxChars: 40 })}
                    </span>
                  )}
                </div>
                <p
                  className="mt-2 truncate font-mono text-[11px]"
                  style={{ color: 'var(--text-muted)' }}
                  title={p.baseDir}
                >
                  {scrubDisplayText(p.baseDir, { collapseLines: true, maxChars: 80 })}
                </p>
                <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <time dateTime={p.updatedAt} title={formatAbsoluteTime(p.updatedAt)}>
                    {formatRelativeTime(p.updatedAt)}
                  </time>
                </p>
              </button>
              <div className="mt-3 flex justify-end gap-3">
                <button
                  type="button"
                  data-testid={`project-export-${p.id}`}
                  disabled={zipBusy}
                  className="text-xs disabled:opacity-50"
                  style={{ color: 'var(--text-secondary)' }}
                  onClick={() => void handleExportZip(p.id, p.name)}
                >
                  {t('project.exportZip')}
                </button>
                <button
                  type="button"
                  className="text-xs text-red-400 hover:text-red-300"
                  onClick={() => void handleDelete(p.id, p.name)}
                >
                  {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-create-title"
        >
          <div
            className="w-full max-w-md rounded-xl border p-5 shadow-xl"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--bg-primary)',
            }}
          >
            <h2
              id="project-create-title"
              className="text-lg font-semibold"
              style={{ color: 'var(--text-primary)' }}
            >
              {t('project.new')}
            </h2>
            <label className="mt-4 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {t('project.name')}
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('project.namePlaceholder')}
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !creating) void handleCreate();
                }}
              />
            </label>
            <label className="mt-3 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {t('project.importBaseDir')}
              <div className="mt-1 flex gap-2">
                <input
                  value={importBaseDir}
                  onChange={(e) => setImportBaseDir(e.target.value)}
                  placeholder={t('project.importBaseDirPlaceholder')}
                  data-testid="project-base-dir-input"
                  className="min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-sm"
                  style={{
                    borderColor: 'var(--border-primary)',
                    backgroundColor: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="button"
                  data-testid="project-browse-folder"
                  disabled={pickingFolder || creating}
                  onClick={() => void handleBrowseFolder()}
                  title={
                    canNativeFolderPick
                      ? t('project.browseFolder')
                      : t('project.browseFolderUnavailable')
                  }
                  className="shrink-0 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
                  style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                >
                  {pickingFolder ? t('common.loading') : t('project.browseFolder')}
                </button>
              </div>
            </label>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {canNativeFolderPick
                ? t('project.importBaseDirHintNative')
                : t('project.importBaseDirHint')}
            </p>
            {createError && (
              <p className="mt-2 text-sm text-red-400" role="alert">
                {createError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border px-3 py-1.5 text-sm"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={creating || !newName.trim()}
                onClick={() => void handleCreate()}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent, #6366f1)' }}
              >
                {creating ? t('common.loading') : t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Projects;
