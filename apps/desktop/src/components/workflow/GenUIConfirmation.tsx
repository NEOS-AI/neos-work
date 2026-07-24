interface GenUIConfirmationProps {
  schema?: { prompt?: string; confirmLabel?: string; cancelLabel?: string };
  onConfirm: (confirmed: boolean) => void;
}

/**
 * Generative UI confirmation surface (plan Task 6 / OD §12).
 */
export function GenUIConfirmation({ schema, onConfirm }: GenUIConfirmationProps) {
  const prompt =
    typeof schema?.prompt === 'string' ? schema.prompt.trim() : '';
  const confirmLabel =
    (typeof schema?.confirmLabel === 'string' && schema.confirmLabel.trim()) || 'Continue';
  const cancelLabel =
    (typeof schema?.cancelLabel === 'string' && schema.cancelLabel.trim()) || 'Cancel';

  return (
    <div className="space-y-3">
      {prompt && (
        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
          {prompt}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded px-4 py-1.5 text-sm text-white"
          style={{ backgroundColor: '#10b981' }}
          onClick={() => onConfirm(true)}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          className="rounded px-4 py-1.5 text-sm"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-primary)',
          }}
          onClick={() => onConfirm(false)}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
