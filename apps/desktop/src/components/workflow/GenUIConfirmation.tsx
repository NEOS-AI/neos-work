interface GenUIConfirmationProps {
  schema?: { prompt?: string; confirmLabel?: string; cancelLabel?: string };
  onConfirm: (confirmed: boolean) => void;
}

/**
 * Generative UI confirmation surface (plan Task 6 / OD §12).
 */
export function GenUIConfirmation({ schema, onConfirm }: GenUIConfirmationProps) {
  return (
    <div className="space-y-3">
      {schema?.prompt && (
        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
          {schema.prompt}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded px-4 py-1.5 text-sm text-white"
          style={{ backgroundColor: '#10b981' }}
          onClick={() => onConfirm(true)}
        >
          {schema?.confirmLabel ?? 'Continue'}
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
          {schema?.cancelLabel ?? 'Cancel'}
        </button>
      </div>
    </div>
  );
}
