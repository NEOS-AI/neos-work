import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CheckboxField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
} from './fields.js';

describe('form fields', () => {
  it('TextField calls onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="Name" value="" onChange={onChange} placeholder="type…" />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('type…'), 'ab');
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.some((c) => c[0] === 'a' || c[0] === 'b' || c[0] === 'ab')).toBe(true);
  });

  it('TextAreaField shows description', () => {
    render(
      <TextAreaField label="Prompt" value="hi" onChange={() => {}} description="help text" />,
    );
    expect(screen.getByText('help text')).toBeInTheDocument();
    expect(screen.getByDisplayValue('hi')).toBeInTheDocument();
  });

  it('NumberField maps empty to undefined and numeric input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = React.useState<number | undefined>(2);
      return (
        <NumberField
          label="Count"
          value={value}
          onChange={(v) => {
            onChange(v);
            setValue(v);
          }}
        />
      );
    }
    render(<Harness />);
    const input = screen.getByDisplayValue('2');
    await user.clear(input);
    expect(onChange).toHaveBeenCalledWith(undefined);
    await user.type(input, '9');
    expect(onChange.mock.calls.some((c) => c[0] === 9)).toBe(true);
  });

  it('SelectField changes value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField
        label="Mode"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
      />,
    );
    await user.selectOptions(screen.getByRole('combobox'), 'b');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('CheckboxField toggles boolean', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CheckboxField label="Enable" value={false} onChange={onChange} description="flag" />);
    expect(screen.getByText('flag')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
