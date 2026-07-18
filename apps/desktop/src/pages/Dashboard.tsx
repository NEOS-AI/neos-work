import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';
import type { Deployment, Routine, Workflow } from '../lib/engine.js';
import { formatEngineUptime } from '../lib/format-uptime.js';
import { formatRelativeTime } from '../lib/format-relative-time.js';
import {
  pickRecentDeployments,
  pickRecentRoutines,
  pickRecentWorkflows,
} from '../lib/recent-workflows.js';

interface DashboardStats {
  sessions: number | null;
  workflows: number | null;
  skills: number | null;
  plugins: number | null;
  routines: number | null;
  designSystems: number | null;
  deployments: number | null;
  mediaFiles: number | null;
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
    designSystems: null,
    deployments: null,
    mediaFiles: null,
    engineVersion: null,
    engineUptimeSec: null,
  });
  const [recentWorkflows, setRecentWorkflows] = useState<Workflow[]>([]);
  const [recentRoutines, setRecentRoutines] = useState<Routine[]>([]);
  const [recentDeployments, setRecentDeployments] = useState<Deployment[]>([]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    void (async () => {
      const [sessions, workflows, skills, plugins, routines, designSystems, deployments, media, health] =
        await Promise.all([
          client.listSessions().catch(() => null),
          client.listWorkflows().catch(() => null),
          client.listSkills().catch(() => null),
          client.listPlugins().catch(() => null),
          client.listRoutines().catch(() => null),
          client.listDesignSystems().catch(() => null),
          client.listDeployments(undefined, 200).catch(() => null),
          client.listMediaFiles(200).catch(() => null),
          client.health().catch(() => null),
        ]);
      if (cancelled) return;
      const wfList = workflows?.ok && workflows.data ? workflows.data : [];
      const deployList = deployments?.ok && deployments.data ? deployments.data : [];
      setStats({
        sessions: sessions?.ok && sessions.data ? sessions.data.length : null,
        workflows: workflows?.ok && workflows.data ? workflows.data.length : null,
        skills: skills?.ok && skills.data ? skills.data.length : null,
        plugins: plugins?.ok && plugins.data ? plugins.data.length : null,
        routines: routines?.ok && routines.data ? routines.data.length : null,
        designSystems: designSystems?.ok && designSystems.data ? designSystems.data.length : null,
        deployments: deployments?.ok && deployments.data ? deployments.data.length : null,
        mediaFiles: media?.ok && media.data ? media.data.length : null,
        engineVersion: health?.status === 'ok' ? (health.version ?? null) : null,
        engineUptimeSec: health?.status === 'ok' ? (health.uptime ?? null) : null,
      });
      setRecentWorkflows(pickRecentWorkflows(wfList, 5));
      const routineList = routines?.ok && routines.data ? routines.data : [];
      setRecentRoutines(pickRecentRoutines(routineList, 5));
      setRecentDeployments(pickRecentDeployments(deployList, 5));
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
        <StatusCard
          label="Design Systems"
          value={stats.designSystems !== null ? String(stats.designSystems) : '—'}
          detail="DESIGN.md brand contexts"
          color="blue"
          to="/design-systems"
        />
        <StatusCard
          label="Deployments"
          value={stats.deployments !== null ? String(stats.deployments) : '—'}
          detail="Vercel / Cloudflare history"
          color="emerald"
          to="/deployments"
        />
        <StatusCard
          label="Media"
          value={stats.mediaFiles !== null ? String(stats.mediaFiles) : '—'}
          detail="Generated images & audio"
          color="purple"
          to="/media"
        />
      </div>

      {/* Recent workflows */}
      {recentWorkflows.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              Recent workflows
            </h2>
            <Link to="/workflows" className="text-xs" style={{ color: 'var(--text-muted)' }}>
              View all
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {recentWorkflows.map((wf) => (
              <Link
                key={wf.id}
                to={`/workflows/${wf.id}`}
                className="flex items-center justify-between rounded-xl border px-4 py-3 transition-opacity hover:opacity-90"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {wf.name}
                  </p>
                  <p className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>
                    {wf.domain}
                    {' · '}
                    {(wf.nodes?.length ?? 0)} nodes
                  </p>
                </div>
                <span className="shrink-0 text-[10px]" style={{ color: 'var(--text-muted)' }} title={new Date(wf.updatedAt).toLocaleString()}>
                  {formatRelativeTime(wf.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent routines */}
      {recentRoutines.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              Recent routines
            </h2>
            <Link to="/routines" className="text-xs" style={{ color: 'var(--text-muted)' }}>
              View all
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {recentRoutines.map((r) => (
              <Link
                key={r.id}
                to="/routines"
                className="flex items-center justify-between rounded-xl border px-4 py-3 transition-opacity hover:opacity-90"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {r.name}
                  </p>
                  <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                    {r.schedule}
                    {' · '}
                    {r.enabled ? 'enabled' : 'disabled'}
                  </p>
                </div>
                <span
                  className="shrink-0 text-[10px]"
                  style={{ color: 'var(--text-muted)' }}
                  title={r.nextRunAt ? new Date(r.nextRunAt).toLocaleString() : new Date(r.updatedAt).toLocaleString()}
                >
                  {r.nextRunAt
                    ? `next ${formatRelativeTime(r.nextRunAt)}`
                    : formatRelativeTime(r.updatedAt)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent deployments */}
      {recentDeployments.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              Recent deployments
            </h2>
            <Link to="/deployments" className="text-xs" style={{ color: 'var(--text-muted)' }}>
              View all
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {recentDeployments.map((d) => (
              <Link
                key={d.id}
                to={d.workflowId ? `/workflows/${d.workflowId}` : '/deployments'}
                className="flex items-center justify-between rounded-xl border px-4 py-3 transition-opacity hover:opacity-90"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {d.projectName || d.provider}
                  </p>
                  <p className="text-xs capitalize" style={{ color: 'var(--text-muted)' }}>
                    {d.provider}
                    {' · '}
                    {d.status}
                  </p>
                </div>
                <span
                  className="shrink-0 text-[10px]"
                  style={{ color: 'var(--text-muted)' }}
                  title={new Date(d.createdAt).toLocaleString()}
                >
                  {formatRelativeTime(d.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <h2 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          <QuickAction title="Workflows" description="Open the workflow editor" to="/workflows" />
          <QuickAction title="New Session" description="Start a new AI conversation" to="/sessions" />
          <QuickAction title="Templates" description="Start from a starter graph" to="/templates" />
          <QuickAction title="Routines" description="Cron schedules & crystallize" to="/routines" />
          <QuickAction title="Plugins" description="Run OD plugin pipelines" to="/plugins" />
          <QuickAction title="Media" description="Browse generated media files" to="/media" />
          <QuickAction title="Design Systems" description="Edit DESIGN.md contexts" to="/design-systems" />
          <QuickAction title="Deployments" description="Review deploy history" to="/deployments" />
          <QuickAction title="Blocks" description="Built-in & custom blocks" to="/blocks" />
          <QuickAction title="Settings" description="Keys, CLI, MCP OAuth" to="/settings" />
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
