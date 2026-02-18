import { useTranslation } from 'react-i18next';

export function Templates() {
  const { t } = useTranslation('common');

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{t('nav.templates')}</h1>
      <div className="flex flex-col items-center justify-center rounded-xl border py-16" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
        </div>
        <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>Templates will be available in Phase 5</p>
      </div>
    </div>
  );
}
