import { useState } from 'react';

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

export function GenUIForm({ schema, onSubmit }: GenUIFormProps) {
  const fields = Array.isArray(schema?.fields) ? schema.fields : [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ''])),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Trim submitted values so GenUI resume payloads stay clean (plan Task 6)
    const trimmed: Record<string, string> = {};
    for (const field of fields) {
      const raw = values[field.key] ?? '';
      trimmed[field.key] = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
    }
    onSubmit(trimmed);
  };

  if (fields.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        No form fields defined.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {fields.map((field) => (
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
