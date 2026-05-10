import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import type { WorkflowBlock } from '../lib/engine.js';

const DOMAIN_COLORS: Record<string, string> = {
  finance: '#10b981',
  coding: '#3b82f6',
  general: '#8b5cf6',
};

const IMPL_TYPE_LABELS: Record<string, string> = {
  native: 'Built-in',
  prompt: 'Prompt',
  skill: 'Skill',
};

// ── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  block?: WorkflowBlock;
  onSave: (data: Omit<WorkflowBlock, 'isBuiltIn'>) => Promise<void>;
  onClose: () => void;
}

function BlockModal({ block, onSave, onClose }: ModalProps) {
  const isEdit = !!block;
  const [id, setId] = useState(block?.id ?? '');
  const [name, setName] = useState(block?.name ?? '');
  const [domain, setDomain] = useState<WorkflowBlock['domain']>(block?.domain ?? 'general');
  const [category, setCategory] = useState(block?.category ?? 'custom');
  const [description, setDescription] = useState(block?.description ?? '');
  const [implType, setImplType] = useState<WorkflowBlock['implementationType']>(block?.implementationType ?? 'prompt');
  const [promptTemplate, setPromptTemplate] = useState(block?.promptTemplate ?? '');
  const [inputDesc, setInputDesc] = useState(block?.inputDescription ?? '');
  const [outputDesc, setOutputDesc] = useState(block?.outputDescription ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name) { setError('Name is required'); return; }
    if (!isEdit && !id) { setError('ID is required'); return; }
    if (implType === 'prompt' && !promptTemplate) { setError('Prompt template is required'); return; }
    setSaving(true);
    try {
      await onSave({
        id,
        name,
        domain,
        category,
        description,
        implementationType: implType,
        promptTemplate: implType === 'prompt' ? promptTemplate : undefined,
        paramDefs: block?.paramDefs ?? [],
        inputDescription: inputDesc,
        outputDescription: outputDesc,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
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
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            {isEdit ? 'Edit Block' : 'New Block'}
          </h2>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>✕</button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          {!isEdit && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Block ID *</span>
              <input style={inputStyle} value={id} onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))} placeholder="my_custom_block" />
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Name *</span>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="My Custom Block" />
          </label>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Domain</span>
              <select style={inputStyle} value={domain} onChange={(e) => setDomain(e.target.value as WorkflowBlock['domain'])}>
                <option value="general">general</option>
                <option value="finance">finance</option>
                <option value="coding">coding</option>
              </select>
            </label>

            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Category</span>
              <input style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="custom" />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Implementation Type</span>
            <select style={inputStyle} value={implType} onChange={(e) => setImplType(e.target.value as WorkflowBlock['implementationType'])}>
              <option value="prompt">Prompt</option>
              <option value="skill">Skill</option>
              <option value="native">Native (requires server code)</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Description</span>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this block do?"
            />
          </label>

          {implType === 'prompt' && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Prompt Template *</span>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: '120px', fontFamily: 'monospace', fontSize: '0.75rem' }}
                value={promptTemplate}
                onChange={(e) => setPromptTemplate(e.target.value)}
                placeholder="You are a helpful assistant. Given the input:\n{{input}}\n\nProvide..."
              />
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Input Description</span>
            <input style={inputStyle} value={inputDesc} onChange={(e) => setInputDesc(e.target.value)} placeholder="What this block expects as input" />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Output Description</span>
            <input style={inputStyle} value={outputDesc} onChange={(e) => setOutputDesc(e.target.value)} placeholder="What this block returns as output" />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-4" style={{ borderColor: 'var(--border-primary)' }}>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-xs font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

interface CardProps {
  block: WorkflowBlock;
  onEdit: () => void;
  onDelete: () => void;
}

function BlockCard({ block, onEdit, onDelete }: CardProps) {
  const domainColor = DOMAIN_COLORS[block.domain] ?? '#8b5cf6';
  const implLabel = IMPL_TYPE_LABELS[block.implementationType] ?? block.implementationType;

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border p-4"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{block.name}</span>
        <div className="flex shrink-0 gap-1">
          {block.isBuiltIn && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: '#f59e0b22', color: '#f59e0b' }}>
              built-in
            </span>
          )}
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ backgroundColor: `${domainColor}22`, color: domainColor }}
          >
            {block.domain}
          </span>
        </div>
      </div>

      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{block.id}</span>

      <p className="flex-1 text-xs line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
        {block.description || '—'}
      </p>

      <div className="flex items-center justify-between">
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{implLabel}</span>
        {!block.isBuiltIn && (
          <div className="flex gap-1">
            <button
              onClick={onEdit}
              className="rounded-lg px-2.5 py-1 text-[11px]"
              style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              className="rounded-lg px-2.5 py-1 text-[11px]"
              style={{ color: '#ef4444', backgroundColor: '#ef444411' }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function Blocks() {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const [blockList, setBlockList] = useState<WorkflowBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; block?: WorkflowBlock } | null>(null);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    if (!client) return;
    const res = await client.listBlocks();
    if (res.ok && res.data) setBlockList(res.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [client]);

  const handleSave = async (data: Omit<WorkflowBlock, 'isBuiltIn'>) => {
    if (!client) return;
    if (modal?.mode === 'edit' && modal.block) {
      await client.updateBlock(modal.block.id, data);
    } else {
      await client.createBlock(data);
    }
    setModal(null);
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!client || !window.confirm('Are you sure you want to delete this block?')) return;
    await client.deleteBlock(id);
    await load();
  };

  const domains = ['all', 'finance', 'coding', 'general'];
  const filtered = filter === 'all' ? blockList : blockList.filter((b) => b.domain === filter);
  const builtIn = filtered.filter((b) => b.isBuiltIn);
  const custom = filtered.filter((b) => !b.isBuiltIn);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('nav.blocks', 'Blocks')}
        </h1>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)' }}>
            {domains.map((d) => (
              <button
                key={d}
                onClick={() => setFilter(d)}
                className="rounded-md px-3 py-1 text-xs capitalize transition-colors"
                style={{
                  backgroundColor: filter === d ? 'var(--border-secondary)' : undefined,
                  color: filter === d ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            onClick={() => setModal({ mode: 'create' })}
            className="rounded-lg px-3 py-2 text-xs font-medium"
            style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          >
            + New Block
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {builtIn.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Built-in Blocks
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {builtIn.map((b) => (
                  <BlockCard key={b.id} block={b} onEdit={() => {}} onDelete={() => {}} />
                ))}
              </div>
            </section>
          )}

          {custom.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Custom Blocks
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {custom.map((b) => (
                  <BlockCard
                    key={b.id}
                    block={b}
                    onEdit={() => setModal({ mode: 'edit', block: b })}
                    onDelete={() => handleDelete(b.id)}
                  />
                ))}
              </div>
            </section>
          ) : (
            custom.length === 0 && builtIn.length === 0 && (
              <div className="flex h-32 items-center justify-center rounded-xl border" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>No blocks found. Create your first custom block!</span>
              </div>
            )
          )}
        </div>
      )}

      {modal && (
        <BlockModal
          block={modal.block}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
