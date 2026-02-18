import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';

export function Dashboard() {
  const { t } = useTranslation('common');
  const { mode, serverUrl, client } = useEngine();
  const [sessionCount, setSessionCount] = useState<number | null>(null);

  useEffect(() => {
    if (!client) return;
    client.listSessions().then((res) => {
      if (res.ok && res.data) {
        setSessionCount(res.data.length);
      }
    });
  }, [client]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nav.dashboard')}</h1>

      {/* Status Cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatusCard
          label="Engine"
          value={mode === 'host' ? 'Local Engine' : 'Remote'}
          detail={serverUrl ?? ''}
          color="emerald"
        />
        <StatusCard
          label="Sessions"
          value={sessionCount !== null ? String(sessionCount) : '—'}
          detail="Active sessions"
          color="blue"
        />
        <StatusCard label="Skills" value="—" detail="Coming soon" color="purple" />
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction
            title="New Session"
            description="Start a new AI conversation"
            to="/sessions"
          />
          <QuickAction
            title="Install Skills"
            description="Browse and install OpenPackage skills"
            to="/skills"
          />
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
}: {
  label: string;
  value: string;
  detail: string;
  color: 'emerald' | 'blue' | 'purple';
}) {
  const colors = {
    emerald: 'border-emerald-900/40 bg-emerald-950/20',
    blue: 'border-blue-900/40 bg-blue-950/20',
    purple: 'border-purple-900/40 bg-purple-950/20',
  };

  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--text-muted)' }}>{detail}</p>
    </div>
  );
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
