import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';
import type { DesignSystem } from '../lib/engine.js';
import { safeEntityId, scrubDisplayText } from '../lib/format-duration.js';
import { formatAbsoluteTime, formatRelativeTime } from '../lib/format-relative-time.js';
import { formatListCount } from '../lib/list-count.js';
import { sortByName } from '../lib/list-sort.js';
import { filterBySearchText } from '../lib/workflow-list-filter.js';

function isBundledDesignSystem(ds: Pick<DesignSystem, 'source'>): boolean {
  return ds.source === 'bundled';
}

export function DesignSystems() {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const navigate = useNavigate();
  const [systems, setSystems] = useState<DesignSystem[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const filteredSystems = useMemo(() => {
    return sortByName(filterBySearchText(systems, search));
  }, [systems, search]);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setPageError(null);
    try {
      const res = await client.listDesignSystems();
      if (res.ok && res.data) {
        setSystems(res.data);
      } else {
        setSystems([]);
        setPageError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || t('designSystems.loadFailed'),
        );
      }
    } catch (err) {
      setSystems([]);
      const msg = err instanceof Error ? err.message : t('designSystems.loadFailed');
      setPageError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
          || t('designSystems.loadFailed'),
      );
    } finally {
      setLoading(false);
    }
  }, [client, t]);

  useEffect(() => { load(); }, [load]);

  const cancelCreate = useCallback(() => {
    setIsCreating(false);
    setNewName('');
    setNewDescription('');
    setCreateError(null);
  }, []);

  // Escape: cancel create form first, otherwise clear search (list filter hygiene).
  useEffect(() => {
    if (!isCreating && !search) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (isCreating) {
        cancelCreate();
        return;
      }
      if (search) setSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCreating, search, cancelCreate]);

  const handleCreate = async () => {
    if (!client) return;
    // Control-char name/description rejected before trim (align with design-systems API)
    if (/[\0\r\n]/.test(newName)) {
      setCreateError(t('designSystems.invalidName'));
      return;
    }
    if (newDescription && /[\0\r\n]/.test(newDescription)) {
      setCreateError(t('designSystems.invalidDescription'));
      return;
    }
    if (!newName.trim()) return;
    setCreateError(null);
    try {
      const res = await client.createDesignSystem(newName.trim(), newDescription.trim() || undefined);
      if (res.ok && res.data) {
        setSystems((prev) => [...prev, res.data!]);
        setNewName('');
        setNewDescription('');
        setIsCreating(false);
      } else {
        setCreateError(
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
            || t('designSystems.createFailed'),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('designSystems.createFailed');
      setCreateError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
          || t('designSystems.createFailed'),
      );
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!client) return;
    const entityId = safeEntityId(id);
    if (!entityId) {
      window.alert(t('designSystems.invalidId'));
      return;
    }
    const nameSafe =
      scrubDisplayText(name, { collapseLines: true, maxChars: 200 })
      || entityId
      || t('designSystems.fallbackName');
    if (!window.confirm(t('designSystems.confirmDelete', { name: nameSafe }))) return;
    try {
      const res = await client.deleteDesignSystem(entityId);
      if (res.ok) {
        setPageError(null);
        setSystems((prev) => prev.filter((s) => s.id !== id && s.id !== entityId));
      } else {
        setPageError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || t('designSystems.deleteFailed'),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('designSystems.deleteFailed');
      setPageError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
          || t('designSystems.deleteFailed'),
      );
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('designSystems.title')}</h1>
          <p className="text-sm text-white/50 mt-1">
            {t('designSystems.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {systems.length > 0 && (
            <>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('designSystems.searchPlaceholder')}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30"
              />
              <span className="text-xs text-white/40">
                {formatListCount(filteredSystems.length, systems.length)}
              </span>
            </>
          )}
          <button
            onClick={() => { setIsCreating(true); setCreateError(null); }}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            {t('designSystems.new')}
          </button>
        </div>
      </div>

      {pageError && (
        <p className="text-sm text-red-400">
          {scrubDisplayText(pageError, { collapseLines: true, maxChars: 300 }) || pageError}
        </p>
      )}

      {/* Create form */}
      {isCreating && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">{t('designSystems.newTitle')}</h2>
          {createError && (
            <p className="text-sm text-red-400">
              {scrubDisplayText(createError, { collapseLines: true, maxChars: 300 }) || createError}
            </p>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-white/50 block mb-1">{t('designSystems.nameLabel')}</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('designSystems.namePlaceholder')}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              />
            </div>
            <div>
              <label className="text-xs text-white/50 block mb-1">{t('designSystems.descriptionLabel')}</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={t('designSystems.descriptionPlaceholder')}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm transition-colors"
            >
              {t('common.create')}
            </button>
            <button
              onClick={cancelCreate}
              className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-white/40 text-sm">{t('common.loading')}</p>
      ) : systems.length === 0 ? (
        !pageError ? (
          <div className="text-center py-16 space-y-2">
            <p className="text-white/40 text-sm">{t('designSystems.empty')}</p>
            <p className="text-white/30 text-xs">
              {t('designSystems.emptyHint')}
            </p>
          </div>
        ) : null
      ) : filteredSystems.length === 0 ? (
        <p className="text-white/40 text-sm">{t('designSystems.noMatch')}</p>
      ) : (
        <div className="grid gap-3">
          {filteredSystems.map((ds) => (
            <div
              key={ds.id}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/[0.07] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white text-sm">
                    {scrubDisplayText(ds.name, { collapseLines: true, maxChars: 200 })
                      || t('designSystems.fallbackName')}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono">
                    {scrubDisplayText(ds.id, { collapseLines: true, maxChars: 80 }) || '—'}
                  </span>
                  {isBundledDesignSystem(ds) && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                      {t('designSystems.bundled')}
                    </span>
                  )}
                  {ds.hasTokens && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                      {t('designSystems.tokens')}
                    </span>
                  )}
                  {ds.hasComponents && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      {t('designSystems.components')}
                    </span>
                  )}
                </div>
                {ds.description ? (
                  <p className="text-xs text-white/40 mt-0.5 truncate">
                    {scrubDisplayText(ds.description, { collapseLines: true, maxChars: 300 })}
                  </p>
                ) : null}
                <p className="text-xs text-white/30 mt-0.5" title={formatAbsoluteTime(ds.updatedAt)}>
                  {t('designSystems.updated', { time: formatRelativeTime(ds.updatedAt) })}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                <button
                  type="button"
                  onClick={() => navigate(`/design-systems/${ds.id}?mode=view`)}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-xs transition-colors"
                >
                  {t('common.view')}
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/design-systems/${ds.id}`)}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-xs transition-colors"
                >
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  disabled={isBundledDesignSystem(ds)}
                  title={isBundledDesignSystem(ds) ? t('designSystems.deleteDisabled') : undefined}
                  aria-disabled={isBundledDesignSystem(ds)}
                  onClick={() => {
                    if (isBundledDesignSystem(ds)) return;
                    handleDelete(
                      ds.id,
                      scrubDisplayText(ds.name, { collapseLines: true, maxChars: 200 }) || ds.name,
                    );
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-500/10"
                >
                  {t('common.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
