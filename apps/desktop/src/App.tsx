import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type AppMode = 'select' | 'host' | 'client';

export default function App() {
  const [mode, setMode] = useState<AppMode>('select');

  if (mode === 'select') {
    return <ModeSelection onSelect={setMode} />;
  }

  return <MainLayout mode={mode} onDisconnect={() => setMode('select')} />;
}

function ModeSelection({ onSelect }: { onSelect: (mode: AppMode) => void }) {
  const { t } = useTranslation('common');

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-8 bg-neutral-950">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-bold text-neutral-100">{t('app.name')}</h1>
        <p className="text-neutral-400">{t('mode.title')}</p>
        <span className="text-sm text-neutral-500">{t('connection.disconnected')}</span>
      </div>

      <div className="flex gap-4">
        <button
          onClick={() => onSelect('host')}
          className="flex w-64 flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-left transition-colors hover:border-neutral-600"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-950 text-emerald-400">
            <HostIcon />
          </div>
          <h2 className="text-lg font-semibold text-neutral-100">{t('mode.host.title')}</h2>
          <p className="text-sm text-neutral-400">{t('mode.host.description')}</p>
          <span className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            127.0.0.1
          </span>
        </button>

        <button
          onClick={() => onSelect('client')}
          className="flex w-64 flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-left transition-colors hover:border-neutral-600"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-800 text-neutral-400">
            <ClientIcon />
          </div>
          <h2 className="text-lg font-semibold text-neutral-100">{t('mode.client.title')}</h2>
          <p className="text-sm text-neutral-400">{t('mode.client.description')}</p>
          <span className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
            <span className="h-2 w-2 rounded-full bg-neutral-500" />
            Remote pairing
          </span>
        </button>
      </div>
    </div>
  );
}

function MainLayout({ mode, onDisconnect }: { mode: AppMode; onDisconnect: () => void }) {
  const { t } = useTranslation('common');
  const [activePage, setActivePage] = useState('dashboard');

  const navItems = [
    { id: 'dashboard', label: t('nav.dashboard') },
    { id: 'sessions', label: t('nav.sessions') },
    { id: 'templates', label: t('nav.templates') },
    { id: 'skills', label: t('nav.skills') },
    { id: 'settings', label: t('nav.settings') },
  ];

  return (
    <div className="flex h-screen bg-neutral-950">
      {/* Sidebar */}
      <aside className="flex w-52 flex-col border-r border-neutral-800 bg-neutral-950">
        <div className="flex items-center gap-2 p-4">
          <span className="text-lg font-bold text-neutral-100">{t('app.name')}</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              className={`rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                activePage === item.id
                  ? 'bg-neutral-800 text-neutral-100'
                  : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="border-t border-neutral-800 p-4">
          <div className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-emerald-400">{t('connection.connected')}</span>
          </div>
          <p className="mt-1 text-xs text-neutral-500">
            {mode === 'host' ? 'http://127.0.0.1:57286' : 'Remote'}
          </p>
          <button
            onClick={onDisconnect}
            className="mt-3 w-full rounded-lg border border-red-900 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-950"
          >
            {t('connection.stop')}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
          <h2 className="text-lg font-semibold text-neutral-100">
            {navItems.find((i) => i.id === activePage)?.label}
          </h2>
        </header>
        <div className="flex-1 overflow-auto p-6">
          <p className="text-neutral-500">
            {activePage} content will be implemented in Phase 1-2.
          </p>
        </div>
      </main>
    </div>
  );
}

function HostIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function ClientIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}
