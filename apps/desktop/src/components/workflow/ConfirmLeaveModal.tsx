import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface ConfirmLeaveModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmLeaveModal({ onConfirm, onCancel }: ConfirmLeaveModalProps) {
  const { t } = useTranslation('common');

  // Escape keeps the user on the editor (same as Stay)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="w-80 rounded-2xl border p-6 shadow-xl"
        style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-primary)' }}
      >
        <h3 className="mb-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('workflow.unsavedChanges')}
        </h3>
        <p className="mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          {t('workflow.leaveConfirm')}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
          >
            {t('common.stay')}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg px-3 py-1.5 text-xs text-white"
            style={{ backgroundColor: '#ef4444' }}
          >
            {t('workflow.leave')}
          </button>
        </div>
      </div>
    </div>
  );
}
