import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';
import { formatEngineUptime } from '../lib/format-uptime.js';

interface DashboardStats {
  sessions: number | null;
  workflows: number | null;
  skills: number | null;
  plugins: number | null;
  routines: number | null;
  engineVersion: string | null;
  engineUptimeSec: number | null;
}

export function Dashboard() {
  const { t } = useTranslation('common');
  const { mode, serverUrl, client } = useEngine();
  const [stats, setStats] = useState<DashboardStats>({
    sessions: null,
    workflows: null,
    skills: null,
    plugins: null,
    routines: null,
    engineVersion: null,
    engineUptimeSec: null,
  });

  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    void (async () => {
      const [sessions, workflows, skills, plugins, routines, health] = await Promise.all([
        client.listSessions().catch(() => null),
        client.listWorkflows().catch(() => null),
        client.listSkills().catch(() => null),
        client.listPlugins().catch(() => null),
        client.listRoutines().catch(() => null),
        client.health().catch(() => null),
      ]);
      if (cancelled) return;
      setStats({
        sessions: sessions?.ok && sessions.data ? sessions.data.length : null,
        workflows: workflows?.ok && workflows.data ? workflows.data.length : null,
        skills: skills?.ok && skills.data ? skills.data.length : null,
        plugins: plugins?.ok && plugins.data ? plugins.data.length : null,
        routines: routines?.ok && routines.data ? routines.data.length : null,
        engineVersion: health?.status === 'ok' ? (health.version ?? null) : null,
        engineUptimeSec: health?.status === 'ok' ? (health.uptime ?? null) : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const uptimeLabel = formatEngineUptime(stats.engineUptimeSec);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nav.dashboard')}</h1>

      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        <StatusCard
          label="Engine"
          value={mode === 'host' ? 'Local' : mode === 'client' ? 'Remote' : '—'}
          detail={[stats.engineVersion ? `v${stats.engineVersion}` : null, uptimeLabel, serverUrl]
            .filter(Boolean)
            .join(' · ')}
          color="emerald"
        />
        <StatusCard
          label="Workflows"
          value={stats.workflows !== null ? String(stats.workflows) : '—'}
          detail="Saved workflows"
          color="blue"
          to="/workflows"
        />
        <StatusCard
          label="Sessions"
          value={stats.sessions !== null ? String(stats.sessions) : '—'}
          detail="Chat sessions"
          color="blue"
          to="/sessions"
        />
        <StatusCard
          label="Skills"
          value={stats.skills !== null ? String(stats.skills) : '—'}
          detail={stats.plugins != null ? `${stats.plugins} plugin(s)` : 'Installed skills'}
          color="purple"
          to="/skills"
        />
        <StatusCard
          label="Routines"
          value={stats.routines !== null ? String(stats.routines) : '—'}
          detail="Scheduled automations"
          color="purple"
          to="/routines"
        />
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <QuickAction title="Workflows" description="Open the workflow editor" to="/workflows" />
          <QuickAction title="New Session" description="Start a new AI conversation" to="/sessions" />
          <QuickAction title="Templates" description="Start from a starter graph" to="/templates" />
          <QuickAction title="Routines" description="Cron schedules & crystallize" to="/routines" />
          <QuickAction title="Plugins" description="Run OD plugin pipelines" to="/plugins" />
          <QuickAction title="Media" description="Browse generated media files" to="/media" />
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  label,
  value,
  detail,
  color,
  to,
}: {
  label: string;
  value: string;
  detail: string;
  color: 'emerald' | 'blue' | 'purple';
  to?: string;
}) {
  const colors = {
    emerald: 'border-emerald-900/40 bg-emerald-950/20',
    blue: 'border-blue-900/40 bg-blue-950/20',
    purple: 'border-purple-900/40 bg-purple-950/20',
  };

  const inner = (
    <div className={`rounded-xl border p-4 ${colors[color]} ${to ? 'transition-opacity hover:opacity-90' : ''}`}>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>{detail}</p>
    </div>
  );

  if (to) {
    return <Link to={to}>{inner}</Link>;
  }
  return inner;
}

function QuickAction({
  title,
  description,
  to,
}: {
  title: string;
  description: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-xl border p-4 transition-colors"
      style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
    >
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{description}</p>
    </Link>
  );
}
