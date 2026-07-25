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
import { scrubDisplayText } from '../lib/format-duration.js';
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
      e.preventDefault();
      setSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [search]);

  const handleUse = async (tpl: TemplateWorkflow) => {
    if (!client || creating) return;
    // Control-char template names never submitted (align with workflow create)
    if (typeof tpl.name !== 'string' || /[\0\r\n]/.test(tpl.name)) return;
    const name = tpl.name.trim();
    if (!name) return;
    let description: string | undefined;
    if (typeof tpl.description === 'string' && !/\0/.test(tpl.description)) {
      const d = tpl.description.trim();
      if (d) description = d;
    }
    const domainRaw =
      typeof tpl.domain === 'string' && !/[\0\r\n]/.test(tpl.domain)
        ? tpl.domain.trim().toLowerCase()
        : 'general';
    const domain =
      domainRaw === 'finance' || domainRaw === 'coding' || domainRaw === 'general'
        ? domainRaw
        : 'general';
    setCreating(name);
    try {
      const res = await client.createWorkflow({
        name,
        description,
        domain,
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
            const domainSafe =
              scrubDisplayText(tpl.domain, { collapseLines: true, maxChars: 40 }) || 'general';
            const nameSafe =
              scrubDisplayText(tpl.name, { collapseLines: true, maxChars: 200 }) || 'Template';
            const descSafe = tpl.description
              ? scrubDisplayText(tpl.description, { collapseLines: true, maxChars: 500 })
              : '';
            const domainColor = DOMAIN_COLORS[domainSafe] ?? '#8b5cf6';
            const nameKey =
              typeof tpl.name === 'string' && !/[\0\r\n]/.test(tpl.name)
                ? tpl.name.trim()
                : nameSafe;
            const isCreating = creating === nameKey;
            const requiredSettings = inferRequiredSettings(tpl).filter(
              (key) => typeof key === 'string' && !/[\0\r\n]/.test(key) && key.trim(),
            );
            return (
              <div
                // Prefer raw identity (domain+name); scrubbed-only keys can collide
                key={`${domainSafe}::${nameKey}`}
                className="flex flex-col gap-3 rounded-xl border p-4"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{nameSafe}</span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: `${domainColor}22`, color: domainColor }}
                  >
                    {domainSafe}
                  </span>
                </div>
                <p className="flex-1 text-xs line-clamp-3" style={{ color: 'var(--text-muted)' }}>
                  {descSafe}
                </p>
                {requiredSettings.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {requiredSettings.map((key) => (
                      <span
                        key={key.trim()}
                        className="rounded px-1.5 py-0.5 text-[10px]"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                      >
                        {key.trim()}
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
