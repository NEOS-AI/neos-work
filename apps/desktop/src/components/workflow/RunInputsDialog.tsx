import { useEffect, useState } from 'react';

interface RunInputsDialogProps {
  /** Initial values from the trigger node's config.initialInputs */
  defaultInputs?: Record<string, unknown>;
  onConfirm: (inputs: Record<string, unknown>) => void;
  onCancel: () => void;
}

export function RunInputsDialog({ defaultInputs, onConfirm, onCancel }: RunInputsDialogProps) {
  const [jsonText, setJsonText] = useState(() =>
    defaultInputs && Object.keys(defaultInputs).length > 0
      ? JSON.stringify(defaultInputs, null, 2)
      : '{}',
  );
  const [parseError, setParseError] = useState('');

  // Escape cancels the run-with-inputs dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const handleConfirm = () => {
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setParseError('Must be a JSON object.');
        return;
      }
      onConfirm(parsed as Record<string, unknown>);
    } catch {
      setParseError('Invalid JSON.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
    >
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-xl border p-6 shadow-2xl"
        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
      >
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          Run with inputs
        </h2>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Enter a JSON object to pass as trigger inputs. These will override the node's saved initial
          inputs for this run only.
        </p>

        <textarea
          className="w-full rounded-lg border p-3 font-mono text-xs outline-none"
          style={{
            borderColor: parseError ? '#ef4444' : 'var(--border-secondary)',
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            minHeight: '160px',
            resize: 'vertical',
          }}
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            setParseError('');
          }}
          spellCheck={false}
        />

        {parseError && (
          <p className="text-xs text-red-400">{parseError}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm transition-colors"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-secondary)' }}
          >
            Run
          </button>
        </div>
      </div>
    </div>
  );
}
