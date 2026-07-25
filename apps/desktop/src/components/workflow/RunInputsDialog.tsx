import { useEffect, useState } from 'react';

import { scrubDisplayText } from '../../lib/format-duration.js';

interface RunInputsDialogProps {
  /** Initial values from the trigger node's config.initialInputs */
  defaultInputs?: Record<string, unknown>;
  onConfirm: (inputs: Record<string, unknown>) => void;
  onCancel: () => void;
}

const JSON_TEXT_MAX = 50_000;

/** Sanitize trigger default inputs for the JSON editor (control keys dropped). */
function sanitizeDefaultInputs(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Object.keys(clean).length >= 200) break;
    if (typeof k !== 'string' || /[\0\r\n]/.test(k)) continue;
    const key = k.trim();
    if (!key || key.length > 200) continue;
    // Scrub null bytes from string values in the editor seed
    if (typeof v === 'string') {
      clean[key] = scrubDisplayText(v, { maxChars: 10_000 });
    } else {
      clean[key] = v;
    }
  }
  return clean;
}

function seedJsonText(defaultInputs?: Record<string, unknown>): string {
  const clean = sanitizeDefaultInputs(defaultInputs);
  if (Object.keys(clean).length === 0) return '{}';
  try {
    return scrubDisplayText(JSON.stringify(clean, null, 2), { maxChars: JSON_TEXT_MAX }) || '{}';
  } catch {
    return '{}';
  }
}

export function RunInputsDialog({ defaultInputs, onConfirm, onCancel }: RunInputsDialogProps) {
  const [jsonText, setJsonText] = useState(() => seedJsonText(defaultInputs));
  const [parseError, setParseError] = useState('');

  // Escape cancels the run-with-inputs dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const handleConfirm = () => {
    try {
      // Reject null-byte JSON text before parse (hostile seed / paste)
      if (/\0/.test(jsonText)) {
        setParseError('Invalid JSON.');
        return;
      }
      const capped =
        jsonText.length > JSON_TEXT_MAX ? jsonText.slice(0, JSON_TEXT_MAX) : jsonText;
      const parsed = JSON.parse(capped) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setParseError('Must be a JSON object.');
        return;
      }
      // Drop control-char / blank / overlong keys (align with TriggerNode runtime hygiene)
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (Object.keys(clean).length >= 200) break;
        if (typeof k !== 'string' || /[\0\r\n]/.test(k)) continue;
        const key = k.trim();
        if (!key || key.length > 200) continue;
        // Null-byte string values never applied
        if (typeof v === 'string' && /\0/.test(v)) continue;
        clean[key] = v;
      }
      onConfirm(clean);
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
          Enter a JSON object to pass as trigger inputs. These will override the node&apos;s saved initial
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
            // Drop null bytes from live editor input
            const next = e.target.value.replace(/\0/g, '');
            setJsonText(next.length > JSON_TEXT_MAX ? next.slice(0, JSON_TEXT_MAX) : next);
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
