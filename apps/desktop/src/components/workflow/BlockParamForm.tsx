import type { WorkflowBlock } from '../../lib/engine.js';
import { CheckboxField, NumberField, SelectField, TextField } from './fields.js';

export function BlockParamForm(props: {
  block: WorkflowBlock;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const patchParam = (key: string, value: unknown) => {
    // Drop control-char / blank param keys (align with BlockNode params normalize)
    if (typeof key !== 'string' || /[\0\r\n]/.test(key) || !key.trim()) return;
    props.onChange({ ...props.value, [key.trim()]: value });
  };

  if (props.block.paramDefs.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        This block has no editable parameters.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {props.block.paramDefs.map((param) => {
        // Skip control-char / blank param keys entirely
        if (typeof param.key !== 'string' || /[\0\r\n]/.test(param.key) || !param.key.trim()) {
          return null;
        }
        // Prefer trimmed key (align with defaultsForBlock / BlockNode normalize)
        const key = param.key.trim();
        const value = props.value[key] ?? props.value[param.key];
        if (param.type === 'number') {
          return (
            <NumberField
              key={key}
              label={param.label}
              value={typeof value === 'number' ? value : undefined}
              min={param.min}
              max={param.max}
              description={param.description}
              onChange={(next) => patchParam(key, next)}
            />
          );
        }
        if (param.type === 'boolean') {
          return (
            <CheckboxField
              key={key}
              label={param.label}
              value={value === true}
              description={param.description}
              onChange={(next) => patchParam(key, next)}
            />
          );
        }
        if (param.type === 'select') {
          const options = (param.options ?? [])
            .filter((option) => typeof option === 'string' && !/[\0\r\n]/.test(option) && option.trim())
            .map((option) => {
              const v = option.trim();
              return { value: v, label: v };
            });
          return (
            <SelectField
              key={key}
              label={param.label}
              value={
                typeof value === 'string' && !/[\0\r\n]/.test(value) ? value.trim() : ''
              }
              description={param.description}
              options={[{ value: '', label: 'Select...' }, ...options]}
              onChange={(next) => {
                if (next && /[\0\r\n]/.test(next)) return;
                patchParam(key, next ? next.trim() : next);
              }}
            />
          );
        }
        return (
          <TextField
            key={key}
            label={param.label}
            value={typeof value === 'string' ? value : ''}
            description={param.description}
            onChange={(next) => {
              // Null-byte string params never applied (align with BlockNode)
              if (/\0/.test(next)) return;
              patchParam(key, next);
            }}
          />
        );
      })}
    </div>
  );
}
