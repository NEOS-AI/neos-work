import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';

const NAV_ITEMS = [
  { id: 'dashboard', path: '/', icon: DashboardIcon },
  { id: 'sessions', path: '/sessions', icon: SessionsIcon },
  { id: 'workflows', path: '/workflows', icon: WorkflowsIcon },
  { id: 'harnesses', path: '/harnesses', icon: HarnessesIcon },
  { id: 'blocks', path: '/blocks', icon: BlocksIcon },
  { id: 'templates', path: '/templates', icon: TemplatesIcon },
  { id: 'skills', path: '/skills', icon: SkillsIcon },
  { id: 'memory', path: '/memory', icon: MemoryIcon },
  { id: 'design-systems', path: '/design-systems', icon: DesignSystemsIcon },
  { id: 'routines', path: '/routines', icon: RoutinesIcon },
  { id: 'plugins', path: '/plugins', icon: PluginsIcon },
  { id: 'deployments', path: '/deployments', icon: DeploymentsIcon },
  { id: 'settings', path: '/settings', icon: SettingsIcon },
] as const;

export function Sidebar() {
  const { t } = useTranslation('common');
  const { status, mode, serverUrl, disconnect } = useEngine();

  return (
    <aside className="flex w-52 flex-col border-r" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>N</span>
        </div>
        <span className="text-sm font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          {t('app.name')}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-0.5 px-3 pt-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.id}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'font-medium'
                  : ''
              }`
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'color-mix(in srgb, var(--bg-tertiary) 80%, transparent)' : undefined,
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
            })}
          >
            <item.icon />
            {t(`nav.${item.id}`)}
          </NavLink>
        ))}
      </nav>

      {/* Connection status */}
      <div className="border-t p-4" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`h-2 w-2 rounded-full ${
              status === 'connected'
                ? 'bg-emerald-400'
                : status === 'connecting'
                  ? 'animate-pulse bg-yellow-400'
                  : status === 'error'
                    ? 'bg-red-400'
                    : 'bg-[var(--text-muted)]'
            }`}
          />
          <span
            className={
              status === 'connected'
                ? 'font-medium text-emerald-400'
                : status === 'error'
                  ? 'text-red-400'
                  : ''
            }
            style={
              status !== 'connected' && status !== 'error'
                ? { color: 'var(--text-muted)' }
                : undefined
            }
          >
            {status === 'connected'
              ? t('connection.connected')
              : status === 'connecting'
                ? t('connection.connecting')
                : t('connection.disconnected')}
          </span>
        </div>
        {serverUrl && (
          <p className="mt-1 truncate text-xs" style={{ color: 'var(--text-muted)' }}>{serverUrl}</p>
        )}
        {status === 'connected' && (
          <button
            onClick={disconnect}
            className="mt-3 w-full rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-400 transition-colors hover:border-red-800 hover:bg-red-950/30"
          >
            {t('connection.stop')}
          </button>
        )}
      </div>
    </aside>
  );
}

// --- Icons (simple SVG, 16x16) ---

function DashboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SessionsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TemplatesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  );
}

function SkillsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function DesignSystemsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="7" height="7" rx="1" />
      <rect x="15" y="3" width="7" height="7" rx="1" />
      <rect x="2" y="14" width="7" height="7" rx="1" />
      <rect x="15" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function RoutinesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M4.93 4.93l2.83 2.83" />
      <path d="M16.24 16.24l2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="M4.93 19.07l2.83-2.83" />
      <path d="M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function PluginsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.94 11A8.994 8.994 0 0 0 13 3.06V1h-2v2.06A8.994 8.994 0 0 0 3.06 11H1v2h2.06A8.994 8.994 0 0 0 11 20.94V23h2v-2.06A8.994 8.994 0 0 0 20.94 13H23v-2h-2.06Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function DeploymentsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5Z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function WorkflowsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="19" cy="19" r="2" />
      <line x1="7" y1="11.5" x2="17" y2="6.5" />
      <line x1="7" y1="12.5" x2="17" y2="17.5" />
    </svg>
  );
}

function HarnessesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 1 0 10 10H12V2Z" />
      <path d="M12 2a10 10 0 0 1 10 10" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function BlocksIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function MemoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
    </svg>
  );
}
