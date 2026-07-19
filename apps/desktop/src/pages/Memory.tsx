import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import type { MemoryItem, MemoryType, CreateMemoryInput } from '../lib/engine.js';
import {
  loadEnabledFilter,
  saveEnabledFilter,
  type EnabledFilterPref,
} from '../lib/enabled-filter-prefs.js';
import { formatAbsoluteTime, formatRelativeTime } from '../lib/format-relative-time.js';
import { formatListCount } from '../lib/list-count.js';
import { sortByDateDesc } from '../lib/list-sort.js';
import {
  loadMemoryTypeFilter,
  MEMORY_TYPE_FILTERS,
  saveMemoryTypeFilter,
  type MemoryTypeFilter,
} from '../lib/memory-prefs.js';
import { filterByEnabled, filterBySearchText } from '../lib/workflow-list-filter.js';

const TYPE_COLORS: Record<MemoryType, string> = {
  user:      '#3b82f6',
  session:   '#10b981',
  skill:     '#8b5cf6',
  reference: '#6b7280',
};

// ── Modal ────────────────────────────────────────────────────

interface MemoryModalProps {
  item?: MemoryItem;
  onSave: (data: CreateMemoryInput) => Promise<void>;
  onClose: () => void;
}

function MemoryModal({ item, onSave, onClose }: MemoryModalProps) {
  const { t } = useTranslation('common');
  const isEdit = !!item;
  const [name, setName] = useState(item?.name ?? '');
  const [type, setType] = useState<MemoryType>(item?.type ?? 'user');
  const [content, setContent] = useState(item?.content ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) {
      setError('Name and content are required');
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), type, content: content.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: CSSProperties = {
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-secondary)',
    borderRadius: '0.5rem',
    color: 'var(--text-primary)',
    padding: '0.375rem 0.625rem',
    fontSize: '0.8125rem',
    width: '100%',
    outline: 'none',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-auto rounded-2xl border"
        style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border-primary)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isEdit ? t('common.edit') : t('memory.new')}
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Name</span>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="My context" />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Type</span>
            <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value as MemoryType)}>
              <option value="user">user</option>
              <option value="session">session</option>
              <option value="skill">skill</option>
              <option value="reference">reference</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{t('memory.content')}</span>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: '160px', fontFamily: 'monospace', fontSize: '0.75rem' }}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Markdown content..."
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-4" style={{ borderColor: 'var(--border-primary)' }}>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          >
            {saving ? '...' : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function Memory() {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; item: MemoryItem } | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<MemoryTypeFilter>(() => loadMemoryTypeFilter());
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilterPref>(() => loadEnabledFilter('memory'));

  const handleEnabledFilter = (value: EnabledFilterPref) => {
    setEnabledFilter(value);
    saveEnabledFilter('memory', value);
  };

  const handleTypeFilter = (value: MemoryTypeFilter) => {
    setTypeFilter(value);
    saveMemoryTypeFilter(value);
  };

  const filteredItems = useMemo(() => {
    const byType = typeFilter === 'all' ? items : items.filter((i) => i.type === typeFilter);
    const byEnabled = filterByEnabled(byType, enabledFilter);
    const matched = filterBySearchText(byEnabled, search);
    return sortByDateDesc(matched, (i) => i.updatedAt);
  }, [items, search, typeFilter, enabledFilter]);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    const res = await client.listMemories();
    if (res.ok) setItems(res.data ?? []);
    setLoading(false);
  }, [client]);

  useEffect(() => { void load(); }, [load]);

  // Escape: close modal first, otherwise clear search
  useEffect(() => {
    if (!modal && !search) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (modal) {
        setModal(null);
        return;
      }
      if (search) setSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, search]);

  const handleSave = async (data: CreateMemoryInput) => {
    if (!client) return;
    if (modal?.mode === 'edit') {
      await client.updateMemory(modal.item.id, data);
    } else {
      await client.createMemory(data);
    }
    setModal(null);
    void load();
  };

  const handleToggle = async (id: string) => {
    if (!client) return;
    await client.toggleMemory(id);
    void load();
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    if (!window.confirm(t('memory.confirmDelete'))) return;
    await client.deleteMemory(id);
    void load();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div
        className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b px-6 py-4"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <h1 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('memory.title')}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {items.length > 0 && (
            <>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search memory…"
                className="rounded-lg border px-3 py-1.5 text-xs"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  borderColor: 'var(--border-primary)',
                  color: 'var(--text-primary)',
                  minWidth: 160,
                }}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {formatListCount(filteredItems.length, items.length)}
              </span>
              {([
                { id: 'all', label: 'All' },
                { id: 'enabled', label: 'ON' },
                { id: 'disabled', label: 'OFF' },
              ] as const).map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => handleEnabledFilter(chip.id)}
                  className="rounded-lg px-2 py-1 text-[10px] font-medium"
                  style={{
                    backgroundColor: enabledFilter === chip.id ? '#10b981' : 'var(--bg-tertiary)',
                    color: enabledFilter === chip.id ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {chip.label}
                </button>
              ))}
              {MEMORY_TYPE_FILTERS.map((ty) => (
                <button
                  key={ty}
                  type="button"
                  onClick={() => handleTypeFilter(ty)}
                  className="rounded-lg px-2 py-1 text-[10px] font-medium capitalize"
                  style={{
                    backgroundColor: typeFilter === ty ? '#3b82f6' : 'var(--bg-tertiary)',
                    color: typeFilter === ty ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {ty}
                </button>
              ))}
            </>
          )}
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="rounded-xl px-3 py-1.5 text-xs font-medium text-white"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            + {t('memory.new')}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('memory.empty')}</p>
        ) : filteredItems.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No memory items match your filters.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border p-4"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--bg-secondary)',
                  opacity: item.enabled ? 1 : 0.5,
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                      style={{ backgroundColor: TYPE_COLORS[item.type] }}
                    >
                      {item.type}
                    </span>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {item.name}
                    </span>
                    {!item.enabled && (
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        ({t('memory.disabled')})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void handleToggle(item.id)}
                      className="rounded px-2 py-0.5 text-[10px]"
                      style={{
                        backgroundColor: item.enabled ? '#10b98120' : 'var(--bg-tertiary)',
                        color: item.enabled ? '#10b981' : 'var(--text-muted)',
                      }}
                      title={t('memory.toggle')}
                    >
                      {item.enabled ? t('memory.enabled') : t('memory.disabled')}
                    </button>
                    <button
                      onClick={() => setModal({ mode: 'edit', item })}
                      className="rounded px-2 py-0.5 text-[10px]"
                      style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                    >
                      {t('common.edit')}
                    </button>
                    <button
                      onClick={() => void handleDelete(item.id)}
                      className="rounded px-2 py-0.5 text-[10px]"
                      style={{ backgroundColor: '#ef444420', color: '#ef4444' }}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>

                <pre
                  className="mt-2 overflow-x-auto whitespace-pre-wrap rounded p-2 text-[11px] leading-relaxed"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    color: 'var(--text-secondary)',
                    fontFamily: 'monospace',
                    maxHeight: '120px',
                  }}
                >
                  {item.content.slice(0, 300)}{item.content.length > 300 ? '…' : ''}
                </pre>

                <p
                  className="mt-1 text-[10px]"
                  style={{ color: 'var(--text-muted)' }}
                  title={formatAbsoluteTime(item.updatedAt)}
                >
                  {formatRelativeTime(item.updatedAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal && (
        <MemoryModal
          item={modal.mode === 'edit' ? modal.item : undefined}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
