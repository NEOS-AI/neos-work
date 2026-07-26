import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import type { AgentHarness } from '../lib/engine.js';
import {
  DOMAIN_FILTER_OPTIONS,
  loadDomainFilter,
  saveDomainFilter,
  type DomainFilterPref,
} from '../lib/domain-filter-prefs.js';
import { scrubDisplayText } from '../lib/format-duration.js';
import { formatListCount } from '../lib/list-count.js';
import { sortByName } from '../lib/list-sort.js';
import { filterBySearchText } from '../lib/workflow-list-filter.js';

const DOMAIN_COLORS: Record<string, string> = {
  finance: '#10b981',
  coding: '#3b82f6',
  general: '#8b5cf6',
};

export function Harnesses() {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const [harnesses, setHarnesses] = useState<AgentHarness[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<AgentHarness | null>(null);
  const [domainFilter, setDomainFilter] = useState<DomainFilterPref>(() => loadDomainFilter('harnesses'));
  const [search, setSearch] = useState('');

  const handleDomainFilter = (d: DomainFilterPref) => {
    setDomainFilter(d);
    saveDomainFilter('harnesses', d);
  };

  const load = async () => {
    if (!client) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await client.listHarnesses();
      if (res.ok && res.data) {
        setHarnesses(res.data);
      } else {
        setHarnesses([]);
        setLoadError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Failed to load harnesses',
        );
      }
    } catch (err) {
      setHarnesses([]);
      const msg = err instanceof Error ? err.message : 'Failed to load harnesses';
      setLoadError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to load harnesses',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = () => { setEditTarget(null); setShowModal(true); };
  const openEdit = (h: AgentHarness) => { setEditTarget(h); setShowModal(true); };
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

  const handleDelete = async (h: AgentHarness) => {
    if (!client || h.isBuiltIn) return;
    const nameSafe =
      scrubDisplayText(h.name, { collapseLines: true, maxChars: 200 }) || h.id || 'harness';
    if (!window.confirm(t('harness.confirmDelete', { name: nameSafe }))) return;
    try {
      const res = await client.deleteHarness(h.id);
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
      domainFilter === 'all' ? harnesses : harnesses.filter((h) => h.domain === domainFilter);
    return sortByName(filterBySearchText(byDomain, search));
  }, [harnesses, domainFilter, search]);

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
            placeholder="Search harnesses…"
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderColor: 'var(--border-primary)',
              color: 'var(--text-primary)',
              minWidth: 160,
            }}
          />
          {harnesses.length > 0 && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatListCount(visible.length, harnesses.length)}
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

      {/* Harness grid */}
      {harnesses.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('harness.empty')}</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>No harnesses match filters</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((h) => (
            <HarnessCard
              key={h.id}
              harness={h}
              onEdit={() => openEdit(h)}
              onDelete={() => handleDelete(h)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <HarnessModal
          existing={editTarget}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function HarnessCard({
  harness: h,
  onEdit,
  onDelete,
}: {
  harness: AgentHarness;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('common');
  const domainSafe =
    scrubDisplayText(h.domain, { collapseLines: true, maxChars: 40 }) || 'general';
  const nameSafe =
    scrubDisplayText(h.name, { collapseLines: true, maxChars: 200 }) || 'Harness';
  const descSafe = scrubDisplayText(h.description, { collapseLines: true, maxChars: 500 });
  const domainColor = DOMAIN_COLORS[domainSafe] ?? '#8b5cf6';
  const tools = (h.allowedTools ?? [])
    .filter((tool) => typeof tool === 'string' && !/[\0\r\n]/.test(tool) && tool.trim())
    .map((tool) => tool.trim())
    .slice(0, 4);

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border p-4"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{nameSafe}</span>
            {h.isBuiltIn && (
              <span className="rounded-full px-1.5 py-0.5 text-[10px]"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                built-in
              </span>
            )}
          </div>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium w-fit"
            style={{ backgroundColor: `${domainColor}22`, color: domainColor }}
          >
            {domainSafe}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="rounded-lg px-2 py-1 text-xs"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}
          >
            {h.isBuiltIn ? t('common.view') : t('common.edit')}
          </button>
          {!h.isBuiltIn && (
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
          {h.allowedTools.length > 4 && (
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              +{h.allowedTools.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function HarnessModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: AgentHarness | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const readOnly = existing?.isBuiltIn ?? false;

  // Seed edit form with scrubbed fields (control chars never re-enter inputs)
  const [id, setId] = useState(
    () => scrubDisplayText(existing?.id, { collapseLines: true, maxChars: 100 }),
  );
  const [name, setName] = useState(
    () => scrubDisplayText(existing?.name, { collapseLines: true, maxChars: 200 }),
  );
  const [domain, setDomain] = useState<'finance' | 'coding' | 'general'>(existing?.domain ?? 'general');
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!client || readOnly) return;
    // Control-char id/name rejected before trim; null-byte prompt/description rejected
    if ((!existing && /[\0\r\n]/.test(id)) || /[\0\r\n]/.test(name)) {
      setError('Name or ID contains invalid control characters');
      return;
    }
    if (/\0/.test(systemPrompt) || /\0/.test(description)) {
      setError('Fields contain invalid control characters');
      return;
    }
    if (!id.trim() || !name.trim() || !systemPrompt.trim()) {
      setError(t('harness.validationError'));
      return;
    }
    setSaving(true);
    setError('');
    // Drop control-char tool tokens before trim
    const tools = allowedTools
      .split(',')
      .filter((s) => !/[\0\r\n]/.test(s))
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const res = existing
        ? await client.updateHarness(existing.id, {
            name: name.trim(),
            domain,
            description: description.trim(),
            systemPrompt: systemPrompt.trim(),
            allowedTools: tools,
          })
        : await client.createHarness({
            id: id.trim(),
            name: name.trim(),
            domain,
            description: description.trim(),
            systemPrompt: systemPrompt.trim(),
            allowedTools: tools,
          });
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
        className="relative w-full max-w-xl rounded-2xl border p-6 shadow-2xl"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
      >
        <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          {existing ? (readOnly ? t('harness.viewTitle') : t('harness.editTitle')) : t('harness.createTitle')}
        </h2>

        <div className="flex flex-col gap-3">
          {/* ID */}
          {!existing && (
            <ModalField label="ID">
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="my_harness_id"
                className="modal-input"
                style={inputStyle}
              />
            </ModalField>
          )}

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
              onChange={(e) => setDomain(e.target.value as 'finance' | 'coding' | 'general')}
              disabled={readOnly}
              style={inputStyle}
            >
              <option value="finance">Finance</option>
              <option value="coding">Coding</option>
              <option value="general">General</option>
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
