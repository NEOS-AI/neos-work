interface GenUIConfirmationProps {
  schema?: { prompt?: string; confirmLabel?: string; cancelLabel?: string };
  onConfirm: (confirmed: boolean) => void;
}

/**
 * Generative UI confirmation surface (plan Task 6 / OD §12).
 */
function safeLabel(raw: unknown, fallback: string): string {
  // Control-char labels fall back to defaults (check before trim)
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return fallback;
  const label = raw.trim();
  // Cap button label length so hostile schema cannot blow up the layout
  if (!label || label.length > 100) return fallback;
  return label;
}

export function GenUIConfirmation({ schema, onConfirm }: GenUIConfirmationProps) {
  // Null-byte prompt hidden; multi-line collapsed for display; cap length for layout
  let prompt = '';
  if (typeof schema?.prompt === 'string' && !/\0/.test(schema.prompt)) {
    prompt = schema.prompt.replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
  }
  const confirmLabel = safeLabel(schema?.confirmLabel, 'Continue');
  const cancelLabel = safeLabel(schema?.cancelLabel, 'Cancel');

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
