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
  return (
    <div className="space-y-3">
      {schema.prompt && (
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{schema.prompt}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {schema.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onSelect(opt.value ?? opt.label)}
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
