interface ChoiceOption {
  label: string;
  previewUrl?: string;
  value?: string;
}

interface GenUIChoiceProps {
  schema: { prompt?: string; options: ChoiceOption[] };
  onSelect: (value: string) => void;
}

function safeChoiceText(raw: unknown): string {
  // Control-char labels/values dropped (check before trim)
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim();
}

function safePreviewUrl(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const s = raw.trim();
  if (!s || s.length > 2_048) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return s;
  } catch {
    return '';
  }
}

export function GenUIChoice({ schema, onSelect }: GenUIChoiceProps) {
  const options = Array.isArray(schema?.options) ? schema.options : [];
  // Null-byte prompt hidden; multi-line OK after collapse
  let prompt = '';
  if (typeof schema?.prompt === 'string' && !/\0/.test(schema.prompt)) {
    prompt = schema.prompt.replace(/[\r\n]+/g, ' ').trim();
  }

  if (options.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        No choices available.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {prompt && (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{prompt}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {options.map((opt, i) => {
          const label = safeChoiceText(opt.label) || safeChoiceText(opt.value);
          // Prefer value; fall back to label only when value is absent/control-char
          const value = safeChoiceText(opt.value) || safeChoiceText(opt.label);
          // Skip options with no selectable value (control-char only)
          if (!value) return null;
          const previewUrl = safePreviewUrl(opt.previewUrl);
          return (
            <button
              key={i}
              type="button"
              onClick={() => {
                if (value) onSelect(value);
              }}
              disabled={!value}
              className="rounded-lg border p-3 text-left transition-colors hover:border-blue-500 disabled:opacity-50"
              style={{
                borderColor: 'var(--border-primary)',
                backgroundColor: 'var(--bg-secondary)',
              }}
            >
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt={label || value}
                  className="w-full h-24 object-cover rounded mb-2"
                />
              )}
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {label || value}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
