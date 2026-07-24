interface ChoiceOption {
  label: string;
  previewUrl?: string;
  value?: string;
}

interface GenUIChoiceProps {
  schema: { prompt?: string; options: ChoiceOption[] };
  onSelect: (value: string) => void;
}

export function GenUIChoice({ schema, onSelect }: GenUIChoiceProps) {
  const options = Array.isArray(schema?.options) ? schema.options : [];
  const prompt = typeof schema?.prompt === 'string' ? schema.prompt.trim() : '';

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
          const label = typeof opt.label === 'string' ? opt.label : String(opt.label ?? '');
          const valueRaw = opt.value ?? opt.label;
          const value =
            typeof valueRaw === 'string' ? valueRaw.trim() : String(valueRaw ?? '').trim();
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
              {opt.previewUrl && (
                <img
                  src={opt.previewUrl}
                  alt={label}
                  className="w-full h-24 object-cover rounded mb-2"
                />
              )}
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
