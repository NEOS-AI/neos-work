import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';
import type { Workflow } from '../lib/engine.js';
import { safeEntityId, scrubDisplayText } from '../lib/format-duration.js';
import { formatListCount } from '../lib/list-count.js';
import { formatAbsoluteTime, formatRelativeTime } from '../lib/format-relative-time.js';
import { sortByDateDesc, sortByName } from '../lib/list-sort.js';
import { filterWorkflowList } from '../lib/workflow-list-filter.js';
import {
  loadWorkflowListDomain,
  loadWorkflowListSort,
  saveWorkflowListDomain,
  saveWorkflowListSort,
  type WorkflowListDomainFilter,
  type WorkflowListSortMode,
} from '../lib/workflow-list-prefs.js';

const DOMAIN_COLORS: Record<string, string> = {
  finance: '#10b981',
  coding: '#3b82f6',
  general: '#8b5cf6',
};

type SortMode = WorkflowListSortMode;

export function Workflows() {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState<'finance' | 'coding' | 'general'>('general');
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [domainFilter, setDomainFilter] = useState<WorkflowListDomainFilter>(() => loadWorkflowListDomain());
  const [sortMode, setSortMode] = useState<SortMode>(() => loadWorkflowListSort());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null);

  const closeCreateModal = useCallback(() => {
    setShowModal(false);
    setNewName('');
    setCreating(false);
  }, []);

  // Escape: close create modal first, otherwise clear search
  useEffect(() => {
    if (!showModal && !search) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (showModal) {
        closeCreateModal();
        return;
      }
      if (search) setSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showModal, search, closeCreateModal]);

  const handleSortModeChange = (mode: SortMode) => {
    setSortMode(mode);
    saveWorkflowListSort(mode);
  };

  const handleDomainFilterChange = (domain: WorkflowListDomainFilter) => {
    setDomainFilter(domain);
    saveWorkflowListDomain(domain);
  };

  const filteredWorkflows = useMemo(() => {
    const filtered = filterWorkflowList(workflows, {
      search,
      domain: domainFilter,
    });
    if (sortMode === 'name') return sortByName(filtered);
    return sortByDateDesc(filtered, (w) => w.updatedAt);
  }, [workflows, search, domainFilter, sortMode]);

  const handleCopyId = async (id: string) => {
    try {
      const write = navigator.clipboard?.writeText;
      if (typeof write !== 'function') throw new Error('Clipboard unavailable');
      // Scrub before clipboard (null-byte / control-char defense)
      const safe = scrubDisplayText(id, { collapseLines: true, maxChars: 200 });
      await write.call(navigator.clipboard, safe);
      setCopyFailedId(null);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      setCopiedId(null);
      setCopyFailedId(id);
      setTimeout(() => setCopyFailedId((cur) => (cur === id ? null : cur)), 2000);
    }
  };

  const loadWorkflows = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await client.listWorkflows();
      if (res.ok) {
        setWorkflows(res.data ?? []);
      } else {
        setWorkflows([]);
        setLoadError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Failed to load workflows',
        );
      }
    } catch (err) {
      setWorkflows([]);
      const msg = err instanceof Error ? err.message : 'Failed to load workflows';
      setLoadError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to load workflows',
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client) return;
    // Control-char name rejected before trim (align with workflow API)
    if (/[\0\r\n]/.test(newName)) {
      window.alert('Name contains invalid control characters');
      return;
    }
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const triggerId = crypto.randomUUID();
      const outputId = crypto.randomUUID();
      const res = await client.createWorkflow({
        name: newName.trim(),
        domain: newDomain,
        nodes: [
          { id: triggerId, type: 'trigger', label: 'Trigger', position: { x: 80, y: 200 }, config: {} },
          { id: outputId, type: 'output', label: 'Output', position: { x: 520, y: 200 }, config: {} },
        ],
        edges: [{ id: crypto.randomUUID(), source: triggerId, target: outputId }],
      });
      if (res.ok && res.data) {
        closeCreateModal();
        navigate(`/workflows/${res.data.id}`);
      } else {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Create workflow failed';
        window.alert(err);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Create workflow failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Create workflow failed',
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    const entityId = safeEntityId(id);
    if (!entityId) {
      window.alert('Workflow id contains invalid control characters');
      return;
    }
    if (!window.confirm(t('workflow.confirmDelete'))) return;
    try {
      const res = await client.deleteWorkflow(entityId);
      if (!res.ok) {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Delete failed';
        window.alert(err);
        return;
      }
      setWorkflows((prev) => prev.filter((w) => w.id !== id && w.id !== entityId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      window.alert(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Delete failed');
    }
  };

  const handleDuplicate = async (id: string) => {
    if (!client) return;
    const entityId = safeEntityId(id);
    if (!entityId) {
      window.alert('Workflow id contains invalid control characters');
      return;
    }
    try {
      const res = await client.duplicateWorkflow(entityId);
      if (res.ok) {
        await loadWorkflows();
      } else {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Duplicate failed';
        window.alert(err);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Duplicate failed';
      window.alert(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Duplicate failed');
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const claudeZipInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !client) return;
    try {
      const text = await file.text();
      // Reject null-byte JSON payloads before parse (hostile paste / file)
      if (/\0/.test(text)) {
        window.alert('JSON import failed: invalid control characters');
        return;
      }
      const data = JSON.parse(text) as unknown;
      const res = await client.importWorkflow(data as Parameters<typeof client.importWorkflow>[0]);
      if (res.ok && res.data) {
        navigate(`/workflows/${res.data.id}`);
      } else {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'JSON import failed';
        window.alert(err);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'JSON import failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'JSON import failed',
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleImportZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !client) return;
    try {
      // Handles both NEOS workflow.json ZIPs and Claude Design HTML-only ZIPs
      const res = await client.importWorkflowZip(file);
      if (res.ok && res.data) {
        navigate(`/workflows/${res.data.id}`);
      } else {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'ZIP import failed';
        window.alert(err);
      }
    } catch {
      window.alert('ZIP import failed');
    } finally {
      e.target.value = '';
    }
  };

  const handleImportClaudeDesign = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !client) return;
    try {
      const res = await client.importClaudeDesignZip(file);
      if (res.ok && res.data) {
        navigate(`/workflows/${res.data.id}`);
      } else {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Claude Design import failed';
        window.alert(err);
      }
    } catch {
      window.alert('Claude Design import failed');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('nav.workflows')}
        </h1>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          <input ref={zipInputRef} type="file" accept=".zip" className="hidden" onChange={handleImportZip} />
          <input ref={claudeZipInputRef} type="file" accept=".zip" className="hidden" onChange={handleImportClaudeDesign} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            {t('workflow.import')} (JSON)
          </button>
          <button
            onClick={() => zipInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            {t('workflow.import')} (ZIP)
          </button>
          <button
            onClick={() => claudeZipInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
            title="Import Claude Design HTML ZIP as workflow + artifact"
          >
            Import (Claude Design)
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: '#10b981' }}
          >
            <span className="text-base leading-none">+</span>
            {t('workflow.new')}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {workflows.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workflows…"
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
                minWidth: 200,
              }}
            />
            {(['all', 'finance', 'coding', 'general'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => handleDomainFilterChange(d)}
                className="rounded-lg px-2.5 py-1 text-xs font-medium capitalize"
                style={{
                  backgroundColor: domainFilter === d ? '#10b981' : 'var(--bg-tertiary)',
                  color: domainFilter === d ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {d}
              </button>
            ))}
            <select
              value={sortMode}
              onChange={(e) => handleSortModeChange(e.target.value as SortMode)}
              className="rounded-lg border px-2 py-1 text-xs"
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-secondary)',
              }}
              title="Sort order"
            >
              <option value="updated">Sort: Updated</option>
              <option value="name">Sort: Name</option>
            </select>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatListCount(filteredWorkflows.length, workflows.length)}
            </span>
          </div>
        )}
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
        ) : loadError ? (
          <p className="text-sm text-red-400">
            {scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 }) || loadError}
          </p>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('workflow.empty')}</p>
            <button
              onClick={() => setShowModal(true)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: '#10b981' }}
            >
              {t('workflow.new')}
            </button>
            <button
              onClick={() => navigate('/templates')}
              className="rounded-lg px-4 py-2 text-sm font-medium"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            >
              Start from Template
            </button>
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No workflows match your search.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredWorkflows.map((wf) => {
              const domainSafe =
                scrubDisplayText(wf.domain, { collapseLines: true, maxChars: 40 }) || 'general';
              const nameSafe =
                scrubDisplayText(wf.name, { collapseLines: true, maxChars: 200 }) || 'Workflow';
              const descSafe = wf.description
                ? scrubDisplayText(wf.description, { collapseLines: true, maxChars: 500 })
                : '';
              return (
              <div
                key={wf.id}
                className="group relative cursor-pointer rounded-xl border p-5 transition-shadow hover:shadow-md"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
                onClick={() => navigate(`/workflows/${wf.id}`)}
              >
                {/* Domain badge */}
                <span
                  className="mb-3 inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: DOMAIN_COLORS[domainSafe] ?? '#8b5cf6' }}
                >
                  {domainSafe}
                </span>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {nameSafe}
                </h3>
                {descSafe ? (
                  <p className="mt-1 text-xs line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                    {descSafe}
                  </p>
                ) : null}
                <p
                  className="mt-3 text-xs"
                  style={{ color: 'var(--text-muted)' }}
                  title={formatAbsoluteTime(wf.updatedAt)}
                >
                  {formatRelativeTime(wf.updatedAt)}
                  {' · '}
                  {(wf.nodes?.length ?? 0)} nodes
                  {' · '}
                  {(wf.edges?.length ?? 0)} edges
                </p>

                {/* Action buttons */}
                <div className="absolute right-2 top-2 hidden items-center gap-1 group-hover:flex">
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleCopyId(wf.id); }}
                    className="rounded p-1 text-xs"
                    style={{ color: copyFailedId === wf.id ? '#f87171' : 'var(--text-muted)' }}
                    title={
                      copiedId === wf.id
                        ? 'Copied!'
                        : copyFailedId === wf.id
                          ? 'Copy failed'
                          : 'Copy workflow ID'
                    }
                  >
                    {copiedId === wf.id ? '✓' : copyFailedId === wf.id ? '!' : 'ID'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleDuplicate(wf.id); }}
                    className="rounded p-1 text-xs"
                    style={{ color: 'var(--text-muted)' }}
                    title={t('workflow.duplicate')}
                  >
                    ⧉
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleDelete(wf.id); }}
                    className="rounded p-1 text-xs"
                    style={{ color: 'var(--text-muted)' }}
                    title={t('common.delete')}
                  >
                    ✕
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Workflow Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form
            onSubmit={handleCreate}
            className="w-96 rounded-xl border p-6 shadow-xl"
            style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
          >
            <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t('workflow.new')}
            </h2>
            <label className="mb-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>
              {t('workflow.name')}
            </label>
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="mb-3 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              placeholder={t('workflow.namePlaceholder')}
              maxLength={200}
            />
            <label className="mb-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>
              {t('workflow.domain')}
            </label>
            <select
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value as typeof newDomain)}
              className="mb-4 w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
            >
              <option value="general">General</option>
              <option value="finance">Finance</option>
              <option value="coding">Coding</option>
            </select>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!newName.trim() || creating}
                className="flex-1 rounded-lg py-2 text-sm font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#10b981' }}
              >
                {creating ? t('common.loading') : t('common.create')}
              </button>
              <button
                type="button"
                onClick={closeCreateModal}
                className="flex-1 rounded-lg py-2 text-sm font-medium"
                style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
