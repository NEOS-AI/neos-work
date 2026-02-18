import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AppMode } from '../hooks/useEngine.js';
import { useEngine } from '../hooks/useEngine.js';

export function ModeSelection() {
  const { t } = useTranslation('common');
  const { status, error, connect } = useEngine();
  const [remoteUrl, setRemoteUrl] = useState('');

  const handleSelect = (mode: AppMode) => {
    if (mode === 'client' && !remoteUrl) return;
    connect(mode, mode === 'client' ? remoteUrl : undefined);
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-8" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <span className="text-lg font-bold" style={{ color: 'var(--text-secondary)' }}>N</span>
        </div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{t('app.name')}</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t('mode.title')}</p>
        <span
          className={`text-xs ${
            status === 'connecting'
              ? 'text-yellow-400'
              : status === 'error'
                ? 'text-red-400'
                : ''
          }`}
          style={
            status !== 'connecting' && status !== 'error'
              ? { color: 'var(--text-muted)' }
              : undefined
          }
        >
          {status === 'connecting'
            ? t('connection.connecting')
            : error
              ? error
              : t('connection.disconnected')}
        </span>
      </div>

      {/* Mode Cards */}
      <div className="flex gap-4">
        {/* Host Mode */}
        <button
          onClick={() => handleSelect('host')}
          disabled={status === 'connecting'}
          className="flex w-64 flex-col gap-3 rounded-xl border p-6 text-left transition-all disabled:opacity-50"
          style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-950 text-emerald-400">
            <HostIcon />
          </div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('mode.host.title')}</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {t('mode.host.description')}
          </p>
          <span className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            127.0.0.1
          </span>
        </button>

        {/* Client Mode */}
        <div className="flex w-64 flex-col gap-3 rounded-xl border p-6 text-left" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
            <ClientIcon />
          </div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('mode.client.title')}</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {t('mode.client.description')}
          </p>
          <input
            type="text"
            placeholder="http://192.168.1.100:57286"
            value={remoteUrl}
            onChange={(e) => setRemoteUrl(e.target.value)}
            className="mt-1 rounded-lg border px-3 py-1.5 text-xs outline-none"
            style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
          />
          <button
            onClick={() => handleSelect('client')}
            disabled={status === 'connecting' || !remoteUrl}
            className="rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            {status === 'connecting' ? t('connection.connecting') : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}

function HostIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function ClientIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}
