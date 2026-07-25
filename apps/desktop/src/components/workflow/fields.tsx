import type { ReactNode } from 'react';

import { scrubDisplayText } from '../../lib/format-duration.js';

interface FieldShellProps {
  label: string;
  description?: string;
  children: ReactNode;
}

function FieldShell({ label, description, children }: FieldShellProps) {
  const labelSafe = scrubDisplayText(label, { collapseLines: true, maxChars: 100 }) || label;
  const descSafe = description
    ? scrubDisplayText(description, { collapseLines: true, maxChars: 300 })
    : '';
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        {labelSafe}
      </span>
      {children}
      {descSafe ? (
        <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {descSafe}
        </span>
      ) : null}
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
  const placeholder = props.placeholder
    ? scrubDisplayText(props.placeholder, { collapseLines: true, maxChars: 200 }) || undefined
    : undefined;
  return (
    <FieldShell label={props.label} description={props.description}>
      <input
        className={inputClass}
        style={inputStyle}
        value={props.value}
        disabled={props.disabled}
        placeholder={placeholder}
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
  const placeholder = props.placeholder
    ? scrubDisplayText(props.placeholder, { collapseLines: true, maxChars: 200 }) || undefined
    : undefined;
  return (
    <FieldShell label={props.label} description={props.description}>
      <textarea
        className={inputClass}
        style={inputStyle}
        value={props.value}
        rows={props.rows ?? 3}
        disabled={props.disabled}
        placeholder={placeholder}
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
  const options = props.options
    .map((option) => {
      // Drop control-char option values; scrub labels for display
      if (typeof option.value !== 'string' || /[\0\r\n]/.test(option.value)) return null;
      const value = option.value;
      const label =
        scrubDisplayText(option.label, { collapseLines: true, maxChars: 200 }) || value;
      return { value, label };
    })
    .filter((o): o is { value: string; label: string } => o != null);
  return (
    <FieldShell label={props.label} description={props.description}>
      <select
        className={inputClass}
        style={inputStyle}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {options.map((option) => (
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
  const labelSafe = scrubDisplayText(props.label, { collapseLines: true, maxChars: 100 }) || props.label;
  const descSafe = props.description
    ? scrubDisplayText(props.description, { collapseLines: true, maxChars: 300 })
    : '';
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
        <span className="block font-medium">{labelSafe}</span>
        {descSafe ? (
          <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {descSafe}
          </span>
        ) : null}
      </span>
    </label>
  );
}
