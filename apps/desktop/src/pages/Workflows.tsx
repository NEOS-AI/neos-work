import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';
import type { Workflow } from '../lib/engine.js';

const DOMAIN_COLORS: Record<string, string> = {
  finance: '#10b981',
  coding: '#3b82f6',
  general: '#8b5cf6',
};

export function Workflows() {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState<'finance' | 'coding' | 'general'>('general');
  const [showModal, setShowModal] = useState(false);

  const loadWorkflows = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    const res = await client.listWorkflows();
    if (res.ok) setWorkflows(res.data ?? []);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client || !newName.trim()) return;
    setCreating(true);
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
    setCreating(false);
    if (res.ok && res.data) {
      setShowModal(false);
      setNewName('');
      navigate(`/workflows/${res.data.id}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    if (!confirm(t('workflow.confirmDelete'))) return;
    await client.deleteWorkflow(id);
    setWorkflows((prev) => prev.filter((w) => w.id !== id));
  };

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('nav.workflows')}
        </h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white transition-colors"
          style={{ backgroundColor: '#10b981' }}
        >
          <span className="text-base leading-none">+</span>
          {t('workflow.new')}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
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
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className="group relative cursor-pointer rounded-xl border p-5 transition-shadow hover:shadow-md"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
                onClick={() => navigate(`/workflows/${wf.id}`)}
              >
                {/* Domain badge */}
                <span
                  className="mb-3 inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: DOMAIN_COLORS[wf.domain] ?? '#8b5cf6' }}
                >
                  {wf.domain}
                </span>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {wf.name}
                </h3>
                {wf.description && (
                  <p className="mt-1 text-xs line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                    {wf.description}
                  </p>
                )}
                <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {new Date(wf.updatedAt).toLocaleDateString()}
                </p>

                {/* Delete button */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(wf.id); }}
                  className="absolute right-3 top-3 hidden rounded p-1 text-xs group-hover:flex"
                  style={{ color: 'var(--text-muted)' }}
                  title={t('common.delete')}
                >
                  ✕
                </button>
              </div>
            ))}
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
                onClick={() => setShowModal(false)}
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
