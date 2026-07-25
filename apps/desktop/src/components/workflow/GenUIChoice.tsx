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
  // Control-char labels/values dropped (check before trim); cap display length
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const t = raw.trim();
  if (!t) return '';
  return t.length > 200 ? t.slice(0, 200) : t;
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
  const rawOptions = Array.isArray(schema?.options) ? schema.options : [];
  // Null-byte prompt hidden; multi-line collapsed; length capped
  let prompt = '';
  if (typeof schema?.prompt === 'string' && !/\0/.test(schema.prompt)) {
    prompt = schema.prompt.replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
  }

  // Normalize options first so control-only lists show empty state
  const CHOICE_MAX = 50;
  const options = rawOptions
    .map((opt, i) => {
      const label = safeChoiceText(opt.label) || safeChoiceText(opt.value);
      const value = safeChoiceText(opt.value) || safeChoiceText(opt.label);
      if (!value) return null;
      return {
        key: `${i}:${value}`,
        label: label || value,
        value,
        previewUrl: safePreviewUrl(opt.previewUrl),
      };
    })
    .filter((o): o is { key: string; label: string; value: string; previewUrl: string } => o != null)
    .slice(0, CHOICE_MAX);

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
        {options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => onSelect(opt.value)}
              className="rounded-lg border p-3 text-left transition-colors hover:border-blue-500"
              style={{
                borderColor: 'var(--border-primary)',
                backgroundColor: 'var(--bg-secondary)',
              }}
            >
              {opt.previewUrl && (
                <img
                  src={opt.previewUrl}
                  alt={opt.label}
                  className="w-full h-24 object-cover rounded mb-2"
                />
              )}
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {opt.label}
              </span>
            </button>
        ))}
      </div>
    </div>
  );
}
