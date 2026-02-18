import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function Skills() {
  const { t } = useTranslation(['skills', 'common']);
  const [packageUrl, setPackageUrl] = useState('');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{t('skills:title')}</h1>
        <button
          className="rounded-lg border px-4 py-2 text-sm transition-colors"
          style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
        >
          {t('common:action.refresh')}
        </button>
      </div>

      {/* Install from OpenPackage */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <h2 className="mb-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {t('skills:installFromPackage')}
        </h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder={t('skills:installPlaceholder')}
            value={packageUrl}
            onChange={(e) => setPackageUrl(e.target.value)}
            className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
          />
          <button
            disabled={!packageUrl}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-40"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            <DownloadIcon />
            {t('common:action.install')}
          </button>
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Installs OpenPackage packages into the current workspace. Skills should land in
          `.neos-work/skills`.
        </p>
      </section>

      {/* Import local skill */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('skills:importLocal')}</h2>
          <button
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            <ImportIcon />
            {t('common:action.import')}
          </button>
        </div>
        <div className="mt-3 rounded-lg border px-4 py-3" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('skills:noSkillsFound')}</p>
        </div>
      </section>

      {/* Installed skills */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('skills:installed')}</h2>
          <span className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
            0
          </span>
        </div>
        <div className="mt-3 rounded-lg border px-4 py-6 text-center" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('skills:noSkillsInstalled')}</p>
        </div>
      </section>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m8 11 4 4 4-4" />
      <path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" />
    </svg>
  );
}
