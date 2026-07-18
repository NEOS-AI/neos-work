import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import type { SkillData } from '../lib/engine.js';
import { filterBySearchText } from '../lib/workflow-list-filter.js';

export function Skills() {
  const { client } = useEngine();
  const { t } = useTranslation('common');
  const [skills, setSkills] = useState<SkillData[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [tryPrompt, setTryPrompt] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    if (!client) return;
    const res = await client.listSkills();
    if (res.ok && res.data) setSkills(res.data);
  }, [client]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleScan = async () => {
    if (!client || isScanning) return;
    setIsScanning(true);
    setScanResult(null);
    try {
      const res = await client.scanSkills();
      if (res.ok && res.data) {
        setScanResult(`Scanned ${res.data.scanned} skills (${res.data.total} total)`);
        await loadSkills();
      } else {
        setScanResult('Scan failed: ' + (res.error ?? 'unknown error'));
      }
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanResult(null), 4000);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    if (!client) return;
    await client.toggleSkill(id, enabled);
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    await client.deleteSkill(id);
    setSkills((prev) => prev.filter((s) => s.id !== id));
  };

  const handleUpgradeToPlugin = async (id: string) => {
    if (!client) return;
    if (!confirm('Create open-design.json plugin sidecar for this skill?')) return;
    const res = await client.upgradeSkillToPlugin(id);
    if (res.ok && res.data) {
      alert(`Upgraded to plugin: ${res.data.name}\nOpen the Plugins page to run it.`);
    } else {
      alert((res as { error?: string }).error ?? 'Upgrade failed');
    }
  };

  // Sort: featured first, then alphabetical
  const sorted = [...skills].sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return a.name.localeCompare(b.name);
  });

  // Categories + search
  const categories = ['all', ...Array.from(new Set(skills.map((s) => s.category).filter(Boolean)))];
  const filtered = useMemo(() => {
    const byCat = categoryFilter === 'all' ? sorted : sorted.filter((s) => s.category === categoryFilter);
    return filterBySearchText(byCat, search);
  }, [sorted, categoryFilter, search]);

  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Skills</h1>
        <div className="flex items-center gap-2">
          {skills.length > 0 && (
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills…"
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
                minWidth: 180,
              }}
            />
          )}
          <button
            onClick={handleScan}
            disabled={isScanning || !client}
            className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            {isScanning ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <ScanIcon />
            )}
            Scan
          </button>
        </div>
      </div>

      {scanResult && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{scanResult}</p>
      )}

      {/* Skill directories info */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <h2 className="mb-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Skill Directories</h2>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Skills are loaded from:
        </p>
        <ul className="mt-2 space-y-1 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
          <li>~/.config/neos-work/skills/ <span className="font-sans" style={{ color: 'var(--text-muted)' }}>(global)</span></li>
          <li>{'{workspace}'}/.neos-work/skills/ <span className="font-sans" style={{ color: 'var(--text-muted)' }}>(local)</span></li>
        </ul>
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Each skill is a <code className="font-mono">.md</code> file with YAML frontmatter (
          <code className="font-mono">name</code>, <code className="font-mono">description</code>).
          Click <strong>Scan</strong> to discover new skills.
        </p>
      </section>

      {/* Installed skills */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Installed Skills</h2>
          <span className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
            {enabledCount}/{skills.length}
          </span>
        </div>

        {/* Category filter */}
        {categories.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat ?? 'all')}
                className="rounded-full px-2.5 py-0.5 text-xs transition-colors"
                style={{
                  backgroundColor: categoryFilter === (cat ?? 'all') ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: categoryFilter === (cat ?? 'all') ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {cat ?? 'all'}
              </button>
            ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="rounded-lg border px-4 py-6 text-center" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No skills installed. Click Scan to discover skills.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onToggle={(enabled) => handleToggle(skill.id, enabled)}
                onDelete={() => handleDelete(skill.id)}
                onUpgrade={() => void handleUpgradeToPlugin(skill.id)}
                onTry={skill.examplePrompt ? () => setTryPrompt(skill.examplePrompt!) : undefined}
              />
            ))}
          </div>
        )}
      </section>

      {/* Try prompt modal */}
      {tryPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setTryPrompt(null)}
        >
          <div
            className="w-full max-w-lg rounded-xl border p-6"
            style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {t('skill.tryPrompt')}
            </h3>
            <pre
              className="rounded-lg p-3 text-xs whitespace-pre-wrap break-words"
              style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}
            >
              {tryPrompt}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { void navigator.clipboard.writeText(tryPrompt); }}
                className="rounded-lg border px-3 py-1.5 text-xs"
                style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
              >
                Copy
              </button>
              <button
                onClick={() => setTryPrompt(null)}
                className="rounded-lg px-3 py-1.5 text-xs"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillCard({
  skill,
  onToggle,
  onDelete,
  onUpgrade,
  onTry,
}: {
  skill: SkillData;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onUpgrade?: () => void;
  onTry?: () => void;
}) {
  const { t } = useTranslation('common');
  return (
    <div
      className="flex items-start justify-between rounded-lg border px-4 py-3"
      style={{
        borderColor: 'var(--border-primary)',
        backgroundColor: skill.enabled ? 'var(--bg-primary)' : 'color-mix(in srgb, var(--bg-primary) 60%, transparent)',
        opacity: skill.enabled ? 1 : 0.7,
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {skill.featured && (
            <span className="shrink-0 text-[10px]" style={{ color: '#f59e0b' }}>★</span>
          )}
          <span className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {skill.name}
          </span>
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          >
            {skill.source}
          </span>
          {skill.version && (
            <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              v{skill.version}
            </span>
          )}
          {skill.mode && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              style={{ backgroundColor: '#3b82f620', color: '#3b82f6' }}
            >
              {skill.mode}
            </span>
          )}
          {skill.category && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              style={{ backgroundColor: '#8b5cf620', color: '#8b5cf6' }}
            >
              {skill.category}
            </span>
          )}
        </div>
        {skill.description && (
          <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {skill.description}
          </p>
        )}
        {skill.triggers && skill.triggers.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {skill.triggers.map((trigger) => (
              <span
                key={trigger}
                className="rounded px-1.5 py-0.5 text-[10px]"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
              >
                {trigger}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="ml-3 flex shrink-0 items-center gap-2">
        {onUpgrade && (
          <button
            onClick={onUpgrade}
            className="rounded-lg border px-2 py-0.5 text-[10px] transition-colors"
            style={{ borderColor: 'var(--border-secondary)', color: '#a78bfa' }}
            title="Write open-design.json and expose as Plugin"
          >
            → Plugin
          </button>
        )}
        {/* Try button */}
        {onTry && (
          <button
            onClick={onTry}
            className="rounded-lg border px-2 py-0.5 text-[10px] transition-colors"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
          >
            {t('skill.tryPrompt')}
          </button>
        )}

        {/* Enable/disable toggle */}
        <button
          onClick={() => onToggle(!skill.enabled)}
          className="relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full transition-colors"
          style={{ backgroundColor: skill.enabled ? '#059669' : 'var(--bg-tertiary)' }}
          aria-label={skill.enabled ? 'Disable' : 'Enable'}
        >
          <span
            className="inline-block h-4 w-4 transform rounded-full shadow transition-transform"
            style={{
              backgroundColor: 'white',
              transform: skill.enabled ? 'translateX(16px)' : 'translateX(0)',
            }}
          />
        </button>

        {/* Delete button */}
        <button
          onClick={onDelete}
          className="rounded p-1 transition-colors"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Remove skill"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ScanIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    </svg>
  );
}
