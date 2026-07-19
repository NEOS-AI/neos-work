import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';
import type { Workflow } from '../lib/engine.js';
import {
  DOMAIN_FILTER_OPTIONS,
  loadDomainFilter,
  saveDomainFilter,
  type DomainFilterPref,
} from '../lib/domain-filter-prefs.js';
import { formatListCount } from '../lib/list-count.js';
import { inferRequiredSettings } from '../lib/template-required-settings.js';
import { filterWorkflowList } from '../lib/workflow-list-filter.js';

type TemplateWorkflow = Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'>;

const DOMAIN_COLORS: Record<string, string> = {
  finance: '#10b981',
  coding: '#3b82f6',
  general: '#8b5cf6',
};

export function Templates() {
  const { t } = useTranslation('common');
  const { client } = useEngine();
  const navigate = useNavigate();
  const [templateList, setTemplateList] = useState<TemplateWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [filter, setFilter] = useState<DomainFilterPref>(() => loadDomainFilter('templates'));
  const [search, setSearch] = useState('');

  const handleDomainFilter = (d: DomainFilterPref) => {
    setFilter(d);
    saveDomainFilter('templates', d);
  };

  useEffect(() => {
    if (!client) return;
    client.getTemplates().then((res) => {
      if (res.ok && res.data) setTemplateList(res.data as TemplateWorkflow[]);
    }).finally(() => setLoading(false));
  }, [client]);

  // Escape clears search (list filter hygiene).
  useEffect(() => {
    if (!search) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [search]);

  const handleUse = async (tpl: TemplateWorkflow) => {
    if (!client || creating) return;
    setCreating(tpl.name);
    try {
      const res = await client.createWorkflow({
        name: tpl.name,
        description: tpl.description,
        domain: tpl.domain,
        nodes: tpl.nodes,
        edges: tpl.edges,
      });
      if (res.ok && res.data) {
        navigate(`/workflows/${res.data.id}`);
      }
    } finally {
      setCreating(null);
    }
  };

  const domains = DOMAIN_FILTER_OPTIONS;
  const filtered = useMemo(
    () => filterWorkflowList(templateList, { search, domain: filter }),
    [templateList, search, filter],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('nav.templates')}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderColor: 'var(--border-primary)',
              color: 'var(--text-primary)',
              minWidth: 160,
            }}
          />
        <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)' }}>
          {domains.map((d) => (
            <button
              key={d}
              onClick={() => handleDomainFilter(d)}
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
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {formatListCount(filtered.length, templateList.length)}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>No templates found.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tpl) => {
            const domainColor = DOMAIN_COLORS[tpl.domain] ?? '#8b5cf6';
            const isCreating = creating === tpl.name;
            const requiredSettings = inferRequiredSettings(tpl);
            return (
              <div
                key={tpl.name}
                className="flex flex-col gap-3 rounded-xl border p-4"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{tpl.name}</span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: `${domainColor}22`, color: domainColor }}
                  >
                    {tpl.domain}
                  </span>
                </div>
                <p className="flex-1 text-xs line-clamp-3" style={{ color: 'var(--text-muted)' }}>
                  {tpl.description}
                </p>
                {requiredSettings.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {requiredSettings.map((key) => (
                      <span
                        key={key}
                        className="rounded px-1.5 py-0.5 text-[10px]"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {tpl.nodes.length} nodes · {tpl.edges.length} edges
                  </span>
                  <button
                    onClick={() => handleUse(tpl)}
                    disabled={!!creating}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
                  >
                    {isCreating ? '...' : 'Use Template'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
