import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import type { DomainWorker } from '../lib/engine.js';
import {
  DOMAIN_FILTER_OPTIONS,
  loadDomainFilter,
  saveDomainFilter,
  type DomainFilterPref,
} from '../lib/domain-filter-prefs.js';
import { safeEntityId, scrubDisplayText } from '../lib/format-duration.js';
import { formatListCount } from '../lib/list-count.js';
import { sortByName } from '../lib/list-sort.js';
import { filterBySearchText } from '../lib/workflow-list-filter.js';

const DOMAIN_COLORS: Record<string, string> = {
  finance: '#10b981',
  coding: '#3b82f6',
  research: '#06b6d4',
  general: '#8b5cf6',
};

const PACK_DOMAINS = ['finance', 'coding', 'research', 'general'] as const;
const PROFILES = ['read_only', 'read_write', 'execute', 'network', 'full'] as const;
const MODES = ['solo', 'coordinator'] as const;
const WORKSPACES = ['none', 'run', 'isolated'] as const;

type PermissionProfile = (typeof PROFILES)[number];
type WorkerMode = (typeof MODES)[number];
type WorkspaceKind = (typeof WORKSPACES)[number];

function normalizePackDomain(raw: unknown): string {
  const d =
    typeof raw === 'string' && !/[\0\r\n]/.test(raw) ? raw.trim().toLowerCase() : 'general';
  return (PACK_DOMAINS as readonly string[]).includes(d) ? d : 'general';
}

function normalizeProfile(raw: unknown): PermissionProfile {
  const p =
    typeof raw === 'string' && !/[\0\r\n]/.test(raw) ? raw.trim().toLowerCase() : 'full';
  return (PROFILES as readonly string[]).includes(p) ? (p as PermissionProfile) : 'full';
}

function normalizeMode(raw: unknown): WorkerMode {
  const m =
    typeof raw === 'string' && !/[\0\r\n]/.test(raw) ? raw.trim().toLowerCase() : 'solo';
  return (MODES as readonly string[]).includes(m) ? (m as WorkerMode) : 'solo';
}

function normalizeWorkspaceKind(raw: unknown): WorkspaceKind {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const kind = (raw as { kind?: unknown }).kind;
    if (typeof kind === 'string' && (WORKSPACES as readonly string[]).includes(kind)) {
      return kind as WorkspaceKind;
    }
  }
  return 'run';
}

/**
 * Domain Workers page.
 * Primary route: `/workers` (v0.11 M3 / Q37). Alias: `/harnesses` for bookmarks.
 */
export function Workers() {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const [workers, setWorkers] = useState<DomainWorker[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<DomainWorker | null>(null);
  const [domainFilter, setDomainFilter] = useState<DomainFilterPref>(() =>
    loadDomainFilter('workers'),
  );
  const [search, setSearch] = useState('');

  const handleDomainFilter = (d: DomainFilterPref) => {
    setDomainFilter(d);
    saveDomainFilter('workers', d);
    // Keep legacy key in sync for older prefs readers
    saveDomainFilter('harnesses', d);
  };

  const load = async () => {
    if (!client) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await client.listWorkers();
      if (res.ok && res.data) {
        setWorkers(res.data);
      } else {
        setWorkers([]);
        setLoadError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Failed to load workers',
        );
      }
    } catch (err) {
      setWorkers([]);
      const msg = err instanceof Error ? err.message : 'Failed to load workers';
      setLoadError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to load workers',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => { setEditTarget(null); setShowModal(true); };
  const openEdit = (w: DomainWorker) => { setEditTarget(w); setShowModal(true); };
  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditTarget(null);
  }, []);

  // Escape: close modal first, otherwise clear search
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

  const handleDelete = async (w: DomainWorker) => {
    if (!client || w.isBuiltIn) return;
    const safeId = safeEntityId(w.id);
    if (!safeId) {
      window.alert('Worker id contains invalid control characters');
      return;
    }
    const nameSafe =
      scrubDisplayText(w.name, { collapseLines: true, maxChars: 200 }) || safeId || 'worker';
    if (!window.confirm(t('harness.confirmDelete', { name: nameSafe }))) return;
    try {
      const res = await client.deleteWorker(safeId);
      if (!res.ok) {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Delete failed';
        window.alert(err);
        return;
      }
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Delete failed',
      );
    }
  };
  const onSaved = () => { closeModal(); load(); };

  const domains = DOMAIN_FILTER_OPTIONS;
  const visible = useMemo(() => {
    const byDomain =
      domainFilter === 'all' ? workers : workers.filter((w) => w.domain === domainFilter);
    return sortByName(filterBySearchText(byDomain, search));
  }, [workers, domainFilter, search]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {loadError && (
        <p className="text-sm text-red-400">
          {scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 }) || loadError}
        </p>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('harness.title')}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workers…"
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderColor: 'var(--border-primary)',
              color: 'var(--text-primary)',
              minWidth: 160,
            }}
          />
          {workers.length > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatListCount(visible.length, workers.length)}
            </span>
          )}
          <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)' }}>
            {domains.map((d) => (
              <button
                key={d}
                onClick={() => handleDomainFilter(d)}
                className="rounded-md px-3 py-1 text-xs capitalize transition-colors"
                style={{
                  backgroundColor: domainFilter === d ? 'var(--border-secondary)' : undefined,
                  color: domainFilter === d ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            onClick={openCreate}
            className="rounded-lg px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          >
            {t('harness.new')}
          </button>
        </div>
      </div>

      {/* Worker grid */}
      {workers.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('harness.empty')}</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>No workers match filters</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((w) => (
            <WorkerCard
              key={w.id}
              worker={w}
              onEdit={() => openEdit(w)}
              onDelete={() => handleDelete(w)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <WorkerModal
          existing={editTarget}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function WorkerCard({
  worker: w,
  onEdit,
  onDelete,
}: {
  worker: DomainWorker;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('common');
  const domainSafe =
    scrubDisplayText(w.domain, { collapseLines: true, maxChars: 40 }) || 'general';
  const nameSafe =
    scrubDisplayText(w.name, { collapseLines: true, maxChars: 200 }) || 'Worker';
  const descSafe = scrubDisplayText(w.description, { collapseLines: true, maxChars: 500 });
  const domainColor = DOMAIN_COLORS[domainSafe] ?? '#8b5cf6';
  const tools = (w.allowedTools ?? [])
    .filter((tool) => typeof tool === 'string' && !/[\0\r\n]/.test(tool) && tool.trim())
    .map((tool) => tool.trim())
    .slice(0, 4);
  const mode = normalizeMode(w.defaultMode);
  const profile = normalizeProfile(w.permissionProfile);

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border p-4"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{nameSafe}</span>
            {w.isBuiltIn && (
              <span className="rounded-full px-1.5 py-0.5 text-[10px]"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                built-in
              </span>
            )}
            {mode === 'coordinator' && (
              <span className="rounded-full px-1.5 py-0.5 text-[10px]"
                style={{ backgroundColor: '#8b5cf622', color: '#a78bfa' }}>
                coordinator
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium w-fit"
              style={{ backgroundColor: `${domainColor}22`, color: domainColor }}
            >
              {domainSafe}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] w-fit"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
            >
              {profile}
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="rounded-lg px-2 py-1 text-xs"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}
          >
            {w.isBuiltIn ? t('common.view') : t('common.edit')}
          </button>
          {!w.isBuiltIn && (
            <button
              onClick={onDelete}
              className="rounded-lg px-2 py-1 text-xs"
              style={{ color: '#ef4444', backgroundColor: 'var(--bg-tertiary)' }}
            >
              {t('common.delete')}
            </button>
          )}
        </div>
      </div>
      <p className="text-xs line-clamp-2" style={{ color: 'var(--text-muted)' }}>
        {descSafe}
      </p>
      {tools.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {tools.map((tool) => (
            <span
              key={tool}
              className="rounded px-1.5 py-0.5 text-[10px]"
              style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
            >
              {tool}
            </span>
          ))}
          {(w.allowedTools?.length ?? 0) > 4 && (
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              +{(w.allowedTools?.length ?? 0) - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function WorkerModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: DomainWorker | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const readOnly = existing?.isBuiltIn ?? false;

  // Seed edit form with scrubbed fields (control chars never re-enter inputs)
  const [name, setName] = useState(
    () => scrubDisplayText(existing?.name, { collapseLines: true, maxChars: 200 }),
  );
  const [domain, setDomain] = useState<string>(() => normalizePackDomain(existing?.domain));
  const [description, setDescription] = useState(() => {
    const raw = typeof existing?.description === 'string' ? existing.description : '';
    return /\0/.test(raw) ? raw.replace(/\0/g, '') : raw;
  });
  const [systemPrompt, setSystemPrompt] = useState(() => {
    const raw = typeof existing?.systemPrompt === 'string' ? existing.systemPrompt : '';
    return /\0/.test(raw) ? raw.replace(/\0/g, '') : raw;
  });
  const [allowedTools, setAllowedTools] = useState(() =>
    (existing?.allowedTools ?? [])
      .filter((t): t is string => typeof t === 'string' && !/[\0\r\n]/.test(t) && t.trim().length > 0)
      .map((t) => t.trim())
      .join(', '),
  );
  const [permissionProfile, setPermissionProfile] = useState<PermissionProfile>(() =>
    normalizeProfile(existing?.permissionProfile),
  );
  const [defaultMode, setDefaultMode] = useState<WorkerMode>(() =>
    normalizeMode(existing?.defaultMode),
  );
  const [workspaceKind, setWorkspaceKind] = useState<WorkspaceKind>(() =>
    normalizeWorkspaceKind(existing?.workspace),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!client || readOnly) return;
    if (/[\0\r\n]/.test(name)) {
      setError('Name contains invalid control characters');
      return;
    }
    if (/\0/.test(systemPrompt) || /\0/.test(description)) {
      setError('Fields contain invalid control characters');
      return;
    }
    if (!name.trim() || !systemPrompt.trim()) {
      setError(t('harness.validationError'));
      return;
    }
    setSaving(true);
    setError('');
    const tools = allowedTools
      .split(',')
      .filter((s) => !/[\0\r\n]/.test(s))
      .map((s) => s.trim())
      .filter(Boolean);
    const workspace =
      workspaceKind === 'run'
        ? { kind: 'run' as const }
        : workspaceKind === 'isolated'
          ? { kind: 'isolated' as const }
          : { kind: 'none' as const };
    const payload = {
      name: name.trim(),
      domain,
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      allowedTools: tools,
      permissionProfile,
      defaultMode,
      workspace,
    };
    try {
      let res;
      if (existing) {
        const workerId = safeEntityId(existing.id);
        if (!workerId) {
          setError('Worker id contains invalid control characters');
          return;
        }
        res = await client.updateWorker(workerId, payload);
      } else {
        res = await client.createWorker(payload);
      }
      if (!res.ok) {
        setError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Save failed',
        );
        return;
      }
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      setError(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="relative w-full max-w-xl rounded-2xl border p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
      >
        <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          {existing ? (readOnly ? t('harness.viewTitle') : t('harness.editTitle')) : t('harness.createTitle')}
        </h2>

        <div className="flex flex-col gap-3">
          {/* Name */}
          <ModalField label={t('harness.name')}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              className="modal-input"
              style={inputStyle}
            />
          </ModalField>

          {/* Domain */}
          <ModalField label={t('harness.domain')}>
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              disabled={readOnly}
              style={inputStyle}
            >
              <option value="finance">Finance</option>
              <option value="coding">Coding</option>
              <option value="research">Research</option>
              <option value="general">General</option>
            </select>
          </ModalField>

          {/* Permission profile */}
          <ModalField label={t('harness.permissionProfile')}>
            <select
              value={permissionProfile}
              onChange={(e) => setPermissionProfile(e.target.value as PermissionProfile)}
              disabled={readOnly}
              style={inputStyle}
            >
              {PROFILES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </ModalField>

          {/* Default mode */}
          <ModalField label={t('harness.defaultMode')}>
            <select
              value={defaultMode}
              onChange={(e) => setDefaultMode(e.target.value as WorkerMode)}
              disabled={readOnly}
              style={inputStyle}
            >
              <option value="solo">solo</option>
              <option value="coordinator">coordinator</option>
            </select>
          </ModalField>

          {/* Workspace */}
          <ModalField label={t('harness.workspace')}>
            <select
              value={workspaceKind}
              onChange={(e) => setWorkspaceKind(e.target.value as WorkspaceKind)}
              disabled={readOnly}
              style={inputStyle}
            >
              <option value="none">none</option>
              <option value="run">run</option>
              <option value="isolated">isolated</option>
            </select>
          </ModalField>

          {/* Description */}
          <ModalField label={t('harness.description')}>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
              style={inputStyle}
            />
          </ModalField>

          {/* System Prompt */}
          <ModalField label={t('harness.systemPrompt')}>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              disabled={readOnly}
              rows={5}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: '12px' }}
            />
          </ModalField>

          {/* Allowed Tools */}
          <ModalField label={t('harness.allowedTools')}>
            <input
              value={allowedTools}
              onChange={(e) => setAllowedTools(e.target.value)}
              disabled={readOnly}
              placeholder="web_search, read_file, ..."
              style={inputStyle}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t('harness.allowedToolsHint')}
            </p>
          </ModalField>

          {error && (
            <p className="text-xs text-red-400">
              {scrubDisplayText(error, { collapseLines: true, maxChars: 300 }) || error}
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}
          >
            {t('common.cancel')}
          </button>
          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              {saving ? '...' : t('common.save')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: '8px',
  border: '1px solid var(--border-secondary)',
  backgroundColor: 'var(--bg-tertiary)',
  color: 'var(--text-primary)',
  padding: '8px 12px',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
};

/** @deprecated Prefer {@link Workers} — alias for `/harnesses` route stability. */
export const Harnesses = Workers;
