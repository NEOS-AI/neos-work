import type { WorkflowBlock } from '../../lib/engine.js';
import { CheckboxField, NumberField, SelectField, TextField } from './fields.js';

export function BlockParamForm(props: {
  block: WorkflowBlock;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
}) {
  const patchParam = (key: string, value: unknown) => {
    props.onChange({ ...props.value, [key]: value });
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
        const value = props.value[param.key];
        if (param.type === 'number') {
          return (
            <NumberField
              key={param.key}
              label={param.label}
              value={typeof value === 'number' ? value : undefined}
              min={param.min}
              max={param.max}
              description={param.description}
              onChange={(next) => patchParam(param.key, next)}
            />
          );
        }
        if (param.type === 'boolean') {
          return (
            <CheckboxField
              key={param.key}
              label={param.label}
              value={value === true}
              description={param.description}
              onChange={(next) => patchParam(param.key, next)}
            />
          );
        }
        if (param.type === 'select') {
          return (
            <SelectField
              key={param.key}
              label={param.label}
              value={typeof value === 'string' ? value : ''}
              description={param.description}
              options={[
                { value: '', label: 'Select...' },
                ...(param.options ?? []).map((option) => ({ value: option, label: option })),
              ]}
              onChange={(next) => patchParam(param.key, next)}
            />
          );
        }
        return (
          <TextField
            key={param.key}
            label={param.label}
            value={typeof value === 'string' ? value : ''}
            description={param.description}
            onChange={(next) => patchParam(param.key, next)}
          />
        );
      })}
    </div>
  );
}
