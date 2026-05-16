import type { ReactNode } from 'react';

interface FieldShellProps {
  label: string;
  description?: string;
  children: ReactNode;
}

function FieldShell({ label, description, children }: FieldShellProps) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      {children}
      {description && (
        <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {description}
        </span>
      )}
    </label>
  );
}

const inputClass = 'w-full rounded-md border px-2 py-1.5 text-xs outline-none';

const inputStyle = {
  borderColor: 'var(--border-primary)',
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
};

export function TextField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  description?: string;
  placeholder?: string;
}) {
  return (
    <FieldShell label={props.label} description={props.description}>
      <input
        className={inputClass}
        style={inputStyle}
        value={props.value}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </FieldShell>
  );
}

export function TextAreaField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  description?: string;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <FieldShell label={props.label} description={props.description}>
      <textarea
        className={inputClass}
        style={inputStyle}
        value={props.value}
        rows={props.rows ?? 3}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </FieldShell>
  );
}

export function NumberField(props: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  disabled?: boolean;
  description?: string;
  min?: number;
  max?: number;
}) {
  return (
    <FieldShell label={props.label} description={props.description}>
      <input
        className={inputClass}
        style={inputStyle}
        type="number"
        value={props.value ?? ''}
        min={props.min}
        max={props.max}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    </FieldShell>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
  description?: string;
}) {
  return (
    <FieldShell label={props.label} description={props.description}>
      <select
        className={inputClass}
        style={inputStyle}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function CheckboxField(props: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  description?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
      <input
        type="checkbox"
        className="mt-0.5"
        checked={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>
        <span className="block font-medium">{props.label}</span>
        {props.description && (
          <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {props.description}
          </span>
        )}
      </span>
    </label>
  );
}
