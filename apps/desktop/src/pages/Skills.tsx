import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import type {
  CatalogPreviewResult,
  RemoteSkillHit,
  SkillAmbiguousCandidate,
  SkillData,
} from '../lib/engine.js';
import {
  loadEnabledFilter,
  saveEnabledFilter,
  type EnabledFilterPref,
} from '../lib/enabled-filter-prefs.js';
import { safeEntityId, scrubDisplayText } from '../lib/format-duration.js';
import { formatAbsoluteTime, formatRelativeTime } from '../lib/format-relative-time.js';
import { formatListCount } from '../lib/list-count.js';
import { loadSkillsCategoryFilter, saveSkillsCategoryFilter } from '../lib/skills-prefs.js';
import { filterByEnabled, filterBySearchText } from '../lib/workflow-list-filter.js';

const CATALOG_DEBOUNCE_MS = 250;
const CATALOG_MIN_QUERY = 2;
const TRY_LIST_IDS = [
  'vercel-labs/skills/find-skills',
  'vercel-labs/agent-skills/vercel-react-best-practices',
  'anthropics/skills/frontend-design',
] as const;

function settingFlagOn(raw: string | undefined, fallback: boolean): boolean {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  return raw.trim().toLowerCase() !== 'false';
}

export function Skills() {
  const { client } = useEngine();
  const { t } = useTranslation(['common', 'skills']);
  const [skills, setSkills] = useState<SkillData[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>(() => loadSkillsCategoryFilter());
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilterPref>(() => loadEnabledFilter('skills'));
  const [search, setSearch] = useState('');
  const [tryPrompt, setTryPrompt] = useState<string | null>(null);
  /** null | 'ok' | 'fail' — try-prompt Copy button feedback */
  const [tryPromptCopyStatus, setTryPromptCopyStatus] = useState<'ok' | 'fail' | null>(null);
  const [detailSkill, setDetailSkill] = useState<SkillData | null>(null);
  const [catalogEnabled, setCatalogEnabled] = useState(true);
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogOwner, setCatalogOwner] = useState('');
  const [catalogHits, setCatalogHits] = useState<RemoteSkillHit[] | null>(null);
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [catalogSearchError, setCatalogSearchError] = useState<string | null>(null);
  const [tryList, setTryList] = useState<CatalogPreviewResult[]>([]);
  const [tryListErrors, setTryListErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<CatalogPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [installNotice, setInstallNotice] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState<{
    input: { id?: string; url?: string };
    candidates: SkillAmbiguousCandidate[];
  } | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const handleEnabledFilter = (value: EnabledFilterPref) => {
    setEnabledFilter(value);
    saveEnabledFilter('skills', value);
  };

  const handleCategoryFilter = (cat: string) => {
    const next = cat || 'all';
    setCategoryFilter(next);
    saveSkillsCategoryFilter(next);
  };

  const loadSkills = useCallback(async () => {
    if (!client) return;
    setLoadError(null);
    try {
      const res = await client.listSkills();
      if (res.ok && res.data) {
        setSkills(res.data);
      } else {
        setSkills([]);
        setLoadError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Failed to load skills',
        );
      }
    } catch (err) {
      setSkills([]);
      const msg = err instanceof Error ? err.message : 'Failed to load skills';
      setLoadError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to load skills',
      );
    }
  }, [client]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (!client?.getSettings) {
      setCatalogEnabled(true);
      setCatalogReady(true);
      return;
    }
    let cancelled = false;
    client
      .getSettings()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.data) {
          setCatalogEnabled(true);
          return;
        }
        setCatalogEnabled(settingFlagOn(res.data['skills.remoteCatalogEnabled'], true));
      })
      .catch(() => {
        if (!cancelled) setCatalogEnabled(true);
      })
      .finally(() => {
        if (!cancelled) setCatalogReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!catalogReady || !catalogEnabled || !client?.previewRemoteSkill) {
      setTryList([]);
      setTryListErrors([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const ok: CatalogPreviewResult[] = [];
      const failed: string[] = [];
      for (const id of TRY_LIST_IDS) {
        try {
          const res = await client.previewRemoteSkill({ id });
          if (cancelled) return;
          if (res.ok && res.data) ok.push(res.data);
          else failed.push(id);
        } catch {
          if (!cancelled) failed.push(id);
        }
      }
      if (cancelled) return;
      setTryList(ok);
      setTryListErrors(failed);
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogReady, catalogEnabled, client]);

  useEffect(() => {
    if (!catalogEnabled || !client?.searchSkillCatalog) {
      setCatalogHits(null);
      setCatalogSearchError(null);
      setCatalogSearching(false);
      return;
    }
    const q = catalogQuery.trim();
    if (q.length < CATALOG_MIN_QUERY) {
      setCatalogHits(null);
      setCatalogSearchError(null);
      setCatalogSearching(false);
      return;
    }
    let cancelled = false;
    setCatalogSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const owner = catalogOwner.trim();
          const res = await client.searchSkillCatalog(q, owner ? { owner } : undefined);
          if (cancelled) return;
          if (res.ok && res.data) {
            setCatalogHits(res.data.skills);
            setCatalogSearchError(null);
          } else {
            setCatalogHits([]);
            setCatalogSearchError(
              scrubDisplayText((res as { error?: string }).error, {
                collapseLines: true,
                maxChars: 200,
              }) || t('skills:catalogUnavailable'),
            );
          }
        } catch (err) {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : t('skills:catalogUnavailable');
          setCatalogHits([]);
          setCatalogSearchError(
            scrubDisplayText(msg, { collapseLines: true, maxChars: 200 })
            || t('skills:catalogUnavailable'),
          );
        } finally {
          if (!cancelled) setCatalogSearching(false);
        }
      })();
    }, CATALOG_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [catalogEnabled, catalogQuery, catalogOwner, client, t]);

  // Escape: preview → ambiguous → detail drawer → try-prompt → catalog search → installed search
  useEffect(() => {
    if (!preview && !ambiguous && !detailSkill && !tryPrompt && !catalogQuery && !search) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (preview) {
        setPreview(null);
        return;
      }
      if (ambiguous) {
        setAmbiguous(null);
        return;
      }
      if (detailSkill) {
        setDetailSkill(null);
        return;
      }
      if (tryPrompt) {
        setTryPrompt(null);
        setTryPromptCopyStatus(null);
        return;
      }
      if (catalogQuery) {
        setCatalogQuery('');
        return;
      }
      if (search) setSearch('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, ambiguous, detailSkill, tryPrompt, catalogQuery, search]);

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
        const detail =
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 200 }) || 'unknown error';
        setScanResult('Scan failed: ' + detail);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      const detail =
        scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || 'unknown error';
      setScanResult('Scan failed: ' + detail);
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanResult(null), 4000);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    if (!client) return;
    // Control-char / blank / overlong skill ids never sent to toggle API
    const skillId = safeEntityId(id);
    if (!skillId) {
      window.alert('Skill id contains invalid control characters');
      return;
    }
    try {
      const res = await client.toggleSkill(skillId, enabled);
      if (!res.ok) {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Update failed';
        window.alert(err);
        return;
      }
      setSkills((prev) =>
        prev.map((s) => (s.id === id || s.id === skillId ? { ...s, enabled } : s)),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      window.alert(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Update failed');
    }
  };

  const handleDelete = async (id: string) => {
    if (!client) return;
    // Control-char / blank / overlong skill ids never sent to delete API
    const skillId = safeEntityId(id);
    if (!skillId) {
      window.alert('Skill id contains invalid control characters');
      return;
    }
    const target = skills.find((s) => s.id === id || s.id === skillId);
    const confirmKey =
      target?.source === 'remote'
        ? 'skills:deleteRemoteFilesConfirm'
        : 'skills:deleteRegistryConfirm';
    if (!window.confirm(t(confirmKey))) return;
    try {
      const res = await client.deleteSkill(skillId);
      if (!res.ok) {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Delete failed';
        window.alert(err);
        return;
      }
      if (res.data?.restored) {
        await loadSkills();
        return;
      }
      setSkills((prev) => prev.filter((s) => s.id !== id && s.id !== skillId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      window.alert(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Delete failed');
    }
  };

  const handlePreview = async (input: { id?: string; url?: string }) => {
    if (!client?.previewRemoteSkill) return;
    setPreviewLoading(true);
    try {
      const res = await client.previewRemoteSkill(input);
      if (res.ok && res.data) {
        setPreview(res.data);
        return;
      }
      const err =
        scrubDisplayText((res as { error?: string }).error, {
          collapseLines: true,
          maxChars: 300,
        }) || t('skills:catalogUnavailable');
      window.alert(err);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('skills:catalogUnavailable');
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
        || t('skills:catalogUnavailable'),
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleInstall = async (input: { id?: string; url?: string; slug?: string }) => {
    if (!client?.installRemoteSkill) return;
    if (!window.confirm(t('skills:installConfirm'))) return;
    try {
      const res = await client.installRemoteSkill({ ...input, confirm: true });
      if (!res.ok) {
        const candidates = Array.isArray(res.candidates) ? res.candidates : [];
        if (res.error === 'skill_ambiguous' && candidates.length > 0) {
          setAmbiguous({ input: { id: input.id, url: input.url }, candidates });
          return;
        }
        const err =
          scrubDisplayText(res.error, { collapseLines: true, maxChars: 300 })
          || 'Install failed';
        window.alert(err);
        return;
      }
      setAmbiguous(null);
      setPreview(null);
      if (res.data?.shadowed === 'bundled') {
        setInstallNotice(t('skills:shadowedBundled'));
        window.setTimeout(() => setInstallNotice(null), 6000);
      }
      await loadSkills();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Install failed';
      window.alert(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Install failed');
    }
  };

  const handleUpdate = async (id: string) => {
    if (!client?.updateSkill) return;
    const skillId = safeEntityId(id);
    if (!skillId) {
      window.alert('Skill id contains invalid control characters');
      return;
    }
    setUpdatingId(skillId);
    try {
      const res = await client.updateSkill(skillId);
      if (!res.ok) {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Update failed';
        window.alert(err);
        return;
      }
      await loadSkills();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      window.alert(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Update failed');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleUpgradeToPlugin = async (id: string) => {
    if (!client) return;
    // Control-char / blank / overlong skill ids never sent to upgrade API
    const skillId = safeEntityId(id);
    if (!skillId) {
      window.alert('Skill id contains invalid control characters');
      return;
    }
    if (!window.confirm('Create open-design.json plugin sidecar for this skill?')) return;
    try {
      const res = await client.upgradeSkillToPlugin(skillId);
      if (res.ok && res.data) {
        const name =
          scrubDisplayText(res.data.name, { collapseLines: true, maxChars: 200 }) || 'plugin';
        window.alert(`Upgraded to plugin: ${name}\nOpen the Plugins page to run it.`);
      } else {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Upgrade failed';
        window.alert(err);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upgrade failed';
      window.alert(scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Upgrade failed');
    }
  };

  // Sort: featured first, then alphabetical (memoized for stable filter deps)
  const sorted = useMemo(
    () =>
      [...skills].sort((a, b) => {
        if (a.featured && !b.featured) return -1;
        if (!a.featured && b.featured) return 1;
        return a.name.localeCompare(b.name);
      }),
    [skills],
  );

  // Categories + enabled + search (control-char categories never become chips)
  const categories = useMemo(
    () => [
      'all',
      ...Array.from(
        new Set(
          skills
            .map((s) => s.category)
            .filter(
              (c): c is string =>
                typeof c === 'string'
                && !/[\0\r\n]/.test(c)
                && c.trim().length > 0,
            )
            .map((c) => c.trim()),
        ),
      ),
    ],
    [skills],
  );

  // If a persisted category no longer exists, fall back to all (and rewrite prefs)
  useEffect(() => {
    if (skills.length === 0) return;
    if (categoryFilter === 'all' || categories.includes(categoryFilter)) return;
    setCategoryFilter('all');
    saveSkillsCategoryFilter('all');
  }, [skills.length, categoryFilter, categories]);

  const activeCategory =
    categoryFilter === 'all' || categories.includes(categoryFilter) ? categoryFilter : 'all';
  const filtered = useMemo(() => {
    // Match trimmed category (chips store trimmed; padded server values still select)
    const byCat =
      activeCategory === 'all'
        ? sorted
        : sorted.filter((s) => {
            if (typeof s.category !== 'string' || /[\0\r\n]/.test(s.category)) return false;
            return s.category.trim() === activeCategory;
          });
    const byEnabled = filterByEnabled(byCat, enabledFilter);
    return filterBySearchText(byEnabled, search);
  }, [sorted, activeCategory, enabledFilter, search]);

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
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {scrubDisplayText(scanResult, { collapseLines: true, maxChars: 300 }) || scanResult}
        </p>
      )}
      {installNotice && (
        <p className="text-xs" data-testid="skills-shadowed-toast" style={{ color: 'var(--text-secondary)' }}>
          {scrubDisplayText(installNotice, { collapseLines: true, maxChars: 400 }) || installNotice}
        </p>
      )}

      <CatalogSection
        enabled={catalogEnabled}
        query={catalogQuery}
        owner={catalogOwner}
        hits={catalogHits}
        searching={catalogSearching}
        searchError={catalogSearchError}
        tryList={tryList}
        tryListErrors={tryListErrors}
        previewLoading={previewLoading}
        onQuery={setCatalogQuery}
        onOwner={setCatalogOwner}
        onPreview={(input) => void handlePreview(input)}
        onInstall={(input) => void handleInstall(input)}
      />

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
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Installed Skills</h2>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }} title="Enabled / total">
              {enabledCount}/{skills.length} on
            </span>
            {skills.length > 0 && (
              <span className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }} title="Visible / total">
                {formatListCount(filtered.length, skills.length)}
              </span>
            )}
          </div>
        </div>

        {/* Enabled + category filters */}
        {skills.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {([
              { id: 'all', label: 'All' },
              { id: 'enabled', label: 'ON' },
              { id: 'disabled', label: 'OFF' },
            ] as const).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => handleEnabledFilter(chip.id)}
                className="rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: enabledFilter === chip.id ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: enabledFilter === chip.id ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}
        {categories.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategoryFilter(cat ?? 'all')}
                className="rounded-full px-2.5 py-0.5 text-xs transition-colors"
                style={{
                  backgroundColor: activeCategory === (cat ?? 'all') ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: activeCategory === (cat ?? 'all') ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {cat ?? 'all'}
              </button>
            ))}
          </div>
        )}

        {loadError ? (
          <p className="text-sm text-red-400">
            {scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 }) || loadError}
          </p>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border px-4 py-6 text-center" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {skills.length === 0
                ? 'No skills installed. Click Scan to discover skills.'
                : 'No skills match the current filters.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                updating={updatingId === skill.id}
                onToggle={(enabled) => handleToggle(skill.id, enabled)}
                onDelete={() => handleDelete(skill.id)}
                onUpdate={
                  skill.source === 'remote' ? () => void handleUpdate(skill.id) : undefined
                }
                onUpgrade={() => void handleUpgradeToPlugin(skill.id)}
                onTry={skill.examplePrompt ? () => setTryPrompt(skill.examplePrompt!) : undefined}
                onDetails={() => setDetailSkill(skill)}
              />
            ))}
          </div>
        )}
      </section>


      {preview && (
        <CatalogPreviewDrawer
          preview={preview}
          onClose={() => setPreview(null)}
          onInstall={() => void handleInstall({ id: preview.id, url: preview.sourceUrl ?? undefined })}
        />
      )}

      {ambiguous && (
        <AmbiguousPicker
          candidates={ambiguous.candidates}
          onCancel={() => setAmbiguous(null)}
          onPick={(slug) => void handleInstall({ ...ambiguous.input, slug })}
        />
      )}

      {/* Package / skill detail drawer */}
      {detailSkill && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
          data-testid="skill-detail-backdrop"
          onClick={() => setDetailSkill(null)}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-detail-title"
            data-testid="skill-detail-drawer"
            className="flex h-full w-full max-w-md flex-col border-l shadow-xl"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--bg-secondary)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ borderColor: 'var(--border-primary)' }}
            >
              <h3
                id="skill-detail-title"
                className="truncate text-sm font-semibold"
                style={{ color: 'var(--text-primary)' }}
              >
                {scrubDisplayText(detailSkill.name, { collapseLines: true, maxChars: 120 })
                  || 'Skill'}
              </h3>
              <button
                type="button"
                className="rounded px-2 py-1 text-xs"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => setDetailSkill(null)}
              >
                {t('common.cancel')}
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 text-xs">
              {detailSkill.description && (
                <p style={{ color: 'var(--text-secondary)' }}>
                  {scrubDisplayText(detailSkill.description, { maxChars: 2_000 })}
                </p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt style={{ color: 'var(--text-muted)' }}>Source</dt>
                <dd style={{ color: 'var(--text-primary)' }}>
                  {scrubDisplayText(detailSkill.source, { collapseLines: true, maxChars: 40 })
                    || '—'}
                </dd>
                <dt style={{ color: 'var(--text-muted)' }}>Version</dt>
                <dd style={{ color: 'var(--text-primary)' }}>
                  {detailSkill.version
                    ? scrubDisplayText(detailSkill.version, { collapseLines: true, maxChars: 40 })
                    : '—'}
                </dd>
                <dt style={{ color: 'var(--text-muted)' }}>Mode</dt>
                <dd style={{ color: 'var(--text-primary)' }}>{detailSkill.mode || '—'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Category</dt>
                <dd style={{ color: 'var(--text-primary)' }}>{detailSkill.category || '—'}</dd>
                <dt style={{ color: 'var(--text-muted)' }}>Package</dt>
                <dd className="font-mono break-all" style={{ color: 'var(--text-primary)' }}>
                  {detailSkill.packageDir
                    ? scrubDisplayText(detailSkill.packageDir, {
                        collapseLines: true,
                        maxChars: 200,
                      })
                    : 'flat file'}
                </dd>
                <dt style={{ color: 'var(--text-muted)' }}>Path</dt>
                <dd
                  className="font-mono break-all"
                  style={{ color: 'var(--text-secondary)' }}
                  title={scrubDisplayText(detailSkill.path, { collapseLines: true, maxChars: 240 })}
                >
                  {formatSkillPathDisplay(detailSkill.path)}
                </dd>
              </dl>
              {detailSkill.triggers && detailSkill.triggers.length > 0 && (
                <div>
                  <div className="mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Triggers
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {detailSkill.triggers.map((tr) => (
                      <span
                        key={tr}
                        className="rounded px-1.5 py-0.5"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                      >
                        {scrubDisplayText(tr, { collapseLines: true, maxChars: 80 })}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {detailSkill.examples && detailSkill.examples.length > 0 && (
                <div>
                  <div className="mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Examples ({detailSkill.examples.length})
                  </div>
                  <ul className="space-y-1">
                    {detailSkill.examples.map((ex, i) => (
                      <li
                        key={ex.id || ex.key || String(i)}
                        className="rounded border px-2 py-1.5 font-mono"
                        style={{
                          borderColor: 'var(--border-primary)',
                          backgroundColor: 'var(--bg-primary)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {scrubDisplayText(ex.title || ex.key || ex.path || 'example', {
                          collapseLines: true,
                          maxChars: 120,
                        })}
                        {ex.key && (
                          <span className="ml-2 opacity-60">
                            {scrubDisplayText(ex.key, { collapseLines: true, maxChars: 60 })}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detailSkill.assets && detailSkill.assets.length > 0 && (
                <div>
                  <div className="mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Assets
                  </div>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    {detailSkill.assets
                      .map((a) => scrubDisplayText(a, { collapseLines: true, maxChars: 80 }))
                      .join(', ')}
                  </p>
                </div>
              )}
              {detailSkill.references && detailSkill.references.length > 0 && (
                <div>
                  <div className="mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>
                    References
                  </div>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    {detailSkill.references
                      .map((a) => scrubDisplayText(a, { collapseLines: true, maxChars: 80 }))
                      .join(', ')}
                  </p>
                </div>
              )}
              {detailSkill.examplePrompt && (
                <div>
                  <div className="mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>
                    Example prompt
                  </div>
                  <pre
                    className="whitespace-pre-wrap rounded border p-2"
                    style={{
                      borderColor: 'var(--border-primary)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {scrubDisplayText(detailSkill.examplePrompt, { maxChars: 4_000 })}
                  </pre>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

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
              {scrubDisplayText(tryPrompt, { maxChars: 100_000 }) || tryPrompt}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  void (async () => {
                    try {
                      const write = navigator.clipboard?.writeText;
                      if (typeof write !== 'function') throw new Error('Clipboard unavailable');
                      const safe = scrubDisplayText(tryPrompt, { maxChars: 100_000 });
                      await write.call(navigator.clipboard, safe);
                      setTryPromptCopyStatus('ok');
                      setTimeout(() => setTryPromptCopyStatus(null), 1500);
                    } catch {
                      setTryPromptCopyStatus('fail');
                      setTimeout(() => setTryPromptCopyStatus(null), 2000);
                    }
                  })();
                }}
                className="rounded-lg border px-3 py-1.5 text-xs"
                style={{
                  borderColor: 'var(--border-secondary)',
                  color: tryPromptCopyStatus === 'fail' ? '#f87171' : 'var(--text-secondary)',
                }}
              >
                {tryPromptCopyStatus === 'ok'
                  ? 'Copied'
                  : tryPromptCopyStatus === 'fail'
                    ? 'Copy failed'
                    : 'Copy'}
              </button>
              <button
                onClick={() => {
                  setTryPrompt(null);
                  setTryPromptCopyStatus(null);
                }}
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

/** Prefer trailing package-relative segments over full host paths in the drawer. */
function formatSkillPathDisplay(path: string | undefined | null): string {
  const raw = scrubDisplayText(path ?? '', { collapseLines: true, maxChars: 240 });
  if (!raw) return '—';
  const parts = raw.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-3).join('/') || raw;
}

function SkillCard({
  skill,
  updating,
  onToggle,
  onDelete,
  onUpdate,
  onUpgrade,
  onTry,
  onDetails,
}: {
  skill: SkillData;
  updating?: boolean;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
  onUpdate?: () => void;
  onUpgrade?: () => void;
  onTry?: () => void;
  onDetails?: () => void;
}) {
  const { t } = useTranslation(['common', 'skills']);
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
            {scrubDisplayText(skill.name, { collapseLines: true, maxChars: 200 }) || 'Skill'}
          </span>
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          >
            {scrubDisplayText(skill.source, { collapseLines: true, maxChars: 40 }) || 'local'}
          </span>
          {skill.version && (
            <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              v{scrubDisplayText(skill.version, { collapseLines: true, maxChars: 32 }) || '—'}
            </span>
          )}
          {skill.mode && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              style={{ backgroundColor: '#3b82f620', color: '#3b82f6' }}
            >
              {scrubDisplayText(skill.mode, { collapseLines: true, maxChars: 40 }) || 'mode'}
            </span>
          )}
          {skill.source === 'remote' && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              data-testid={`skill-remote-badge-${skill.id}`}
              style={{ backgroundColor: '#0ea5e920', color: '#38bdf8' }}
            >
              remote
            </span>
          )}
          {skill.packageDir && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              style={{ backgroundColor: '#10b98120', color: '#10b981' }}
              title={skill.packageDir}
            >
              package
            </span>
          )}
          {typeof skill.exampleCount === 'number' && skill.exampleCount > 0 && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              style={{ backgroundColor: '#f59e0b20', color: '#f59e0b' }}
            >
              {skill.exampleCount} ex
            </span>
          )}
          {skill.category && typeof skill.category === 'string' && !/[\0\r\n]/.test(skill.category) && skill.category.trim() && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
              style={{ backgroundColor: '#8b5cf620', color: '#8b5cf6' }}
            >
              {scrubDisplayText(skill.category.trim(), { collapseLines: true, maxChars: 40 })}
            </span>
          )}
        </div>
        {skill.description && (
          <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {scrubDisplayText(skill.description, { maxChars: 500 })}
          </p>
        )}
        {skill.installedAt && (
          <p
            className="mt-0.5 text-[10px]"
            style={{ color: 'var(--text-muted)' }}
            title={formatAbsoluteTime(skill.installedAt)}
          >
            Installed {formatRelativeTime(skill.installedAt)}
          </p>
        )}
        {skill.source === 'remote' && (skill.remoteId || skill.remoteHash || skill.skillsShUrl) && (
          <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-muted)' }} data-testid={`skill-provenance-${skill.id}`}>
            {skill.remoteId
              ? scrubDisplayText(skill.remoteId, { collapseLines: true, maxChars: 80 })
              : null}
            {skill.remoteHash ? ` · ${skill.remoteHash.slice(0, 12)}` : ''}
            {skill.skillsShUrl ? (
              <>
                {' · '}
                <a
                  href={skill.skillsShUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#38bdf8' }}
                >
                  {t('skills:skillsShLink')}
                </a>
              </>
            ) : null}
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
        {onDetails && (
          <button
            type="button"
            data-testid={`skill-details-${skill.id}`}
            onClick={onDetails}
            className="rounded-lg border px-2 py-0.5 text-[10px] transition-colors"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
          >
            {t('common.view')}
          </button>
        )}
        {onUpdate && (
          <button
            type="button"
            data-testid={`skill-update-${skill.id}`}
            onClick={onUpdate}
            disabled={updating}
            className="rounded-lg border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
          >
            {t('skills:update')}
          </button>
        )}
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
          data-testid={`skill-delete-${skill.id}`}
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

function CatalogSection({
  enabled,
  query,
  owner,
  hits,
  searching,
  searchError,
  tryList,
  tryListErrors,
  previewLoading,
  onQuery,
  onOwner,
  onPreview,
  onInstall,
}: {
  enabled: boolean;
  query: string;
  owner: string;
  hits: RemoteSkillHit[] | null;
  searching: boolean;
  searchError: string | null;
  tryList: CatalogPreviewResult[];
  tryListErrors: string[];
  previewLoading: boolean;
  onQuery: (q: string) => void;
  onOwner: (owner: string) => void;
  onPreview: (input: { id?: string; url?: string }) => void;
  onInstall: (input: { id?: string; url?: string }) => void;
}) {
  const { t } = useTranslation('skills');
  const searchingCatalog = query.trim().length >= CATALOG_MIN_QUERY;
  return (
    <section
      className="rounded-xl border p-5"
      data-testid="skills-catalog"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
    >
      <h2 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {t('catalogTitle')}
      </h2>
      {!enabled ? (
        <p className="text-sm" data-testid="skills-catalog-disabled" style={{ color: 'var(--text-muted)' }}>
          {t('catalogDisabled')}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <input
              type="search"
              data-testid="skills-catalog-search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={t('catalogSearchPlaceholder')}
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
                minWidth: 220,
                flex: 1,
              }}
            />
            <input
              type="text"
              data-testid="skills-catalog-owner"
              value={owner}
              onChange={(e) => onOwner(e.target.value)}
              placeholder={t('catalogOwnerPlaceholder')}
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: 'var(--bg-primary)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
                minWidth: 140,
              }}
            />
          </div>
          {searchError && (
            <p className="mb-2 text-xs text-red-400" data-testid="skills-catalog-search-error">
              {searchError}
            </p>
          )}
          {tryListErrors.length > 0 && !searchingCatalog && (
            <p className="mb-2 text-xs text-red-400" data-testid="skills-catalog-try-error">
              {t('catalogTryFailed')}
            </p>
          )}
          {searching && (
            <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {t('common:common.loading')}
            </p>
          )}
          {searchingCatalog ? (
            <CatalogHitList
              hits={hits ?? []}
              previewLoading={previewLoading}
              onPreview={onPreview}
              onInstall={onInstall}
            />
          ) : (
            <div>
              <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                {t('catalogEmpty')}
              </p>
              <div className="space-y-2" data-testid="skills-catalog-try-list">
                {tryList.map((item) => (
                  <CatalogRow
                    key={item.id}
                    id={item.id}
                    name={item.name}
                    source={item.sourceUrl ?? item.id}
                    installs={null}
                    href={item.skillsShUrl}
                    previewLoading={previewLoading}
                    onPreview={() => onPreview({ id: item.id })}
                    onInstall={() => onInstall({ id: item.id })}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CatalogHitList({
  hits,
  previewLoading,
  onPreview,
  onInstall,
}: {
  hits: RemoteSkillHit[];
  previewLoading: boolean;
  onPreview: (input: { id?: string; url?: string }) => void;
  onInstall: (input: { id?: string; url?: string }) => void;
}) {
  if (hits.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="skills-catalog-results">
      {hits.map((hit) => (
        <CatalogRow
          key={hit.id}
          id={hit.id}
          name={hit.name}
          source={hit.source}
          installs={hit.installs}
          href={hit.url}
          previewLoading={previewLoading}
          onPreview={() => onPreview({ id: hit.id })}
          onInstall={() => onInstall({ id: hit.id })}
        />
      ))}
    </div>
  );
}

function CatalogRow({
  id,
  name,
  source,
  installs,
  href,
  previewLoading,
  onPreview,
  onInstall,
}: {
  id: string;
  name: string;
  source: string;
  installs: number | null;
  href: string;
  previewLoading: boolean;
  onPreview: () => void;
  onInstall: () => void;
}) {
  const { t } = useTranslation('skills');
  const safeHref = /^https?:\/\//i.test(href) ? href : `https://skills.sh/${id}`;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
      data-testid={`skills-catalog-row-${id}`}
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {scrubDisplayText(name, { collapseLines: true, maxChars: 160 }) || name}
        </div>
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {scrubDisplayText(source, { collapseLines: true, maxChars: 80 })}
          {typeof installs === 'number' ? ` · ${t('installs', { count: installs })}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a
          href={safeHref}
          target="_blank"
          rel="noreferrer"
          className="text-[11px]"
          style={{ color: '#38bdf8' }}
        >
          {t('skillsShLink')}
        </a>
        <button
          type="button"
          data-testid={`skills-catalog-preview-${id}`}
          onClick={onPreview}
          disabled={previewLoading}
          className="rounded-lg border px-2 py-0.5 text-[10px] disabled:opacity-40"
          style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
        >
          {t('preview')}
        </button>
        <button
          type="button"
          data-testid={`skills-catalog-install-${id}`}
          onClick={onInstall}
          className="rounded-lg border px-2 py-0.5 text-[10px]"
          style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
        >
          {t('install')}
        </button>
      </div>
    </div>
  );
}

function CatalogPreviewDrawer({
  preview,
  onClose,
  onInstall,
}: {
  preview: CatalogPreviewResult;
  onClose: () => void;
  onInstall: () => void;
}) {
  const { t } = useTranslation(['skills', 'common']);
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      data-testid="skills-preview-backdrop"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        data-testid="skills-preview-drawer"
        className="flex h-full w-full max-w-md flex-col border-l shadow-xl"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--border-primary)' }}
        >
          <h3 className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {scrubDisplayText(preview.name, { collapseLines: true, maxChars: 120 }) || preview.slug}
          </h3>
          <button type="button" className="rounded px-2 py-1 text-xs" style={{ color: 'var(--text-muted)' }} onClick={onClose}>
            {t('common:common.cancel')}
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4 text-xs">
          <p style={{ color: 'var(--text-secondary)' }}>
            {scrubDisplayText(preview.description, { maxChars: 2_000 })}
          </p>
          <p style={{ color: 'var(--text-muted)' }}>
            {preview.license
              ? scrubDisplayText(preview.license, { collapseLines: true, maxChars: 80 })
              : t('licenseUnknown')}
          </p>
          {preview.hash && (
            <p className="font-mono" style={{ color: 'var(--text-muted)' }}>
              {preview.hash}
            </p>
          )}
          {preview.audits && preview.audits.length > 0 && (
            <ul className="space-y-1">
              {preview.audits.map((a) => (
                <li key={`${a.provider}-${a.slug}`}>
                  {scrubDisplayText(`${a.provider}: ${a.status}`, { collapseLines: true, maxChars: 120 })}
                  {a.summary
                    ? ` — ${scrubDisplayText(a.summary, { collapseLines: true, maxChars: 200 })}`
                    : ''}
                </li>
              ))}
            </ul>
          )}
          {preview.sourceUrl && (
            <a href={preview.sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8' }}>
              {scrubDisplayText(preview.sourceUrl, { collapseLines: true, maxChars: 120 })}
            </a>
          )}
          <p style={{ color: 'var(--text-muted)' }}>{t('thirdPartyDisclaimer')}</p>
          <pre
            className="whitespace-pre-wrap rounded border p-2 font-mono"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-secondary)',
            }}
          >
            {scrubDisplayText(preview.skillMd, { maxChars: 32_000 })}
          </pre>
        </div>
        <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border-primary)' }}>
          <button
            type="button"
            data-testid="skills-preview-install"
            onClick={onInstall}
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
          >
            {t('install')}
          </button>
        </div>
      </aside>
    </div>
  );
}

function AmbiguousPicker({
  candidates,
  onCancel,
  onPick,
}: {
  candidates: SkillAmbiguousCandidate[];
  onCancel: () => void;
  onPick: (slug: string) => void;
}) {
  const { t } = useTranslation(['skills', 'common']);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      data-testid="skills-ambiguous-backdrop"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        data-testid="skills-ambiguous"
        className="w-full max-w-md rounded-xl border p-5"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('skillAmbiguous')}
        </h3>
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.slug} className="flex items-center justify-between gap-2">
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {scrubDisplayText(c.name || c.slug, { collapseLines: true, maxChars: 80 })}
              </span>
              <button
                type="button"
                data-testid={`skills-ambiguous-pick-${c.slug}`}
                onClick={() => onPick(c.slug)}
                className="rounded-lg border px-2 py-0.5 text-[10px]"
                style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
              >
                {t('chooseSkill')}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            {t('common:common.cancel')}
          </button>
        </div>
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
