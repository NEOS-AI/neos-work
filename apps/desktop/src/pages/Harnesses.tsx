import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import type { AgentHarness } from '../lib/engine.js';

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
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState<AgentHarness | null>(null);

  const load = async () => {
    if (!client) return;
    setLoading(true);
    const res = await client.listHarnesses();
    if (res.ok && res.data) setHarnesses(res.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [client]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (h: AgentHarness) => {
    if (!client || h.isBuiltIn) return;
    if (!window.confirm(t('harness.confirmDelete', { name: h.name }))) return;
    await client.deleteHarness(h.id);
    await load();
  };

  const openCreate = () => { setEditTarget(null); setShowModal(true); };
  const openEdit = (h: AgentHarness) => { setEditTarget(h); setShowModal(true); };
  const closeModal = () => setShowModal(false);
  const onSaved = () => { closeModal(); load(); };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('harness.title')}
        </h1>
        <button
          onClick={openCreate}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
        >
          {t('harness.new')}
        </button>
      </div>

      {/* Harness grid */}
      {harnesses.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('harness.empty')}</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {harnesses.map((h) => (
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
  const domainColor = DOMAIN_COLORS[h.domain] ?? '#8b5cf6';

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border p-4"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{h.name}</span>
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
            {h.domain}
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
        {h.description}
      </p>
      {h.allowedTools.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {h.allowedTools.slice(0, 4).map((tool) => (
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

  const [id, setId] = useState(existing?.id ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [domain, setDomain] = useState<'finance' | 'coding' | 'general'>(existing?.domain ?? 'general');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? '');
  const [allowedTools, setAllowedTools] = useState((existing?.allowedTools ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!client || readOnly) return;
    if (!id.trim() || !name.trim() || !systemPrompt.trim()) {
      setError(t('harness.validationError'));
      return;
    }
    setSaving(true);
    setError('');
    const tools = allowedTools.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      if (existing) {
        await client.updateHarness(existing.id, { name, domain, description, systemPrompt, allowedTools: tools });
      } else {
        await client.createHarness({ id: id.trim(), name, domain, description, systemPrompt, allowedTools: tools });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
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

          {error && <p className="text-xs text-red-400">{error}</p>}
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
