import { useMemo, useState } from 'react';

import { scrubDisplayText } from '../../lib/format-duration.js';

interface FormField {
  key: string;
  label: string;
  type: 'text' | 'select' | 'textarea';
  placeholder?: string;
  options?: string[];
}

interface GenUIFormProps {
  schema: { fields: FormField[] };
  onSubmit: (values: Record<string, string>) => void;
}

/** Safe field key for render/submit (control-char rejected before trim). */
function safeFieldKey(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const k = raw.trim();
  return k && k.length <= 200 ? k : '';
}

export function GenUIForm({ schema, onSubmit }: GenUIFormProps) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  // Skip control-char / blank keys for display (align with submit hygiene)
  const visibleFields = useMemo(
    () =>
      fields
        .map((field) => {
          const key = safeFieldKey(field.key);
          if (!key) return null;
          const label =
            scrubDisplayText(field.label, { collapseLines: true, maxChars: 100 }) || key;
          const placeholder = field.placeholder
            ? scrubDisplayText(field.placeholder, { collapseLines: true, maxChars: 200 })
            : undefined;
          const options = (field.options ?? [])
            .filter((opt) => typeof opt === 'string' && !/[\0\r\n]/.test(opt) && opt.trim())
            .map((opt) =>
              scrubDisplayText(opt.trim(), { collapseLines: true, maxChars: 200 }) || opt.trim(),
            )
            .filter((opt) => opt.length > 0)
            .slice(0, 100);
          return { ...field, key, label, placeholder, options };
        })
        .filter((f): f is FormField & { key: string; label: string } => f != null),
    [fields],
  );

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(visibleFields.map((f) => [f.key, ''])),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Trim submitted values so GenUI resume payloads stay clean (plan Task 6).
    // Control-char keys dropped (check before trim).
    const trimmed: Record<string, string> = {};
    for (const field of fields) {
      const key = safeFieldKey(field.key);
      if (!key) continue;
      if (Object.keys(trimmed).length >= 200) break;
      const raw = values[key] ?? values[field.key] ?? '';
      // Null-byte values dropped from resume payload
      if (typeof raw === 'string' && /\0/.test(raw)) continue;
      trimmed[key] = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
    }
    onSubmit(trimmed);
  };

  if (visibleFields.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        No form fields defined.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {visibleFields.map((field) => (
        <div key={field.key}>
          <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>
            {field.label}
          </label>
          {field.type === 'select' ? (
            <select
              className="w-full rounded px-3 py-1.5 text-sm border"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
              }}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            >
              <option value="">— Select —</option>
              {(field.options ?? []).map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : field.type === 'textarea' ? (
            <textarea
              className="w-full rounded px-3 py-1.5 text-sm border resize-none"
              rows={3}
              style={{
                backgroundColor: 'var(--bg-secondary)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
              }}
              placeholder={field.placeholder}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            />
          ) : (
            <input
              className="w-full rounded px-3 py-1.5 text-sm border"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
              }}
              placeholder={field.placeholder}
              value={values[field.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <button
        type="submit"
        className="rounded px-4 py-1.5 text-sm text-white"
        style={{ backgroundColor: '#10b981' }}
      >
        Submit
      </button>
    </form>
  );
}
