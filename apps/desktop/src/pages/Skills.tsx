import { useCallback, useEffect, useState } from 'react';

import { useEngine } from '../hooks/useEngine.js';
import type { SkillData } from '../lib/engine.js';

export function Skills() {
  const { client } = useEngine();
  const [skills, setSkills] = useState<SkillData[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

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

  const enabledCount = skills.filter((s) => s.enabled).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Skills</h1>
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

        {skills.length === 0 ? (
          <div className="rounded-lg border px-4 py-6 text-center" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No skills installed. Click Scan to discover skills.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onToggle={(enabled) => handleToggle(skill.id, enabled)}
                onDelete={() => handleDelete(skill.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SkillCard({
  skill,
  onToggle,
  onDelete,
}: {
  skill: SkillData;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
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
        <div className="flex items-center gap-2">
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
        </div>
        {skill.description && (
          <p className="mt-0.5 line-clamp-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            {skill.description}
          </p>
        )}
      </div>

      <div className="ml-3 flex shrink-0 items-center gap-2">
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
