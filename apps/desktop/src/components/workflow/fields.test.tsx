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

  it('honors disabled on text, number, select, and checkbox fields', async () => {
    const user = userEvent.setup();
    const onText = vi.fn();
    const onNum = vi.fn();
    const onSelect = vi.fn();
    const onCheck = vi.fn();

    render(
      <>
        <TextField label="T" value="x" onChange={onText} disabled description="locked text" />
        <NumberField label="N" value={3} onChange={onNum} disabled />
        <SelectField
          label="S"
          value="a"
          onChange={onSelect}
          disabled
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />
        <CheckboxField label="C" value={false} onChange={onCheck} disabled />
      </>,
    );

    expect(screen.getByText('locked text')).toBeInTheDocument();
    expect(screen.getByDisplayValue('x')).toBeDisabled();
    expect(screen.getByDisplayValue('3')).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(onCheck).not.toHaveBeenCalled();
  });

  it('scrubs control-char labels, descriptions, placeholders, and select options', () => {
    render(
      <>
        <TextField
          label={`Name${'\0'}X`}
          value=""
          onChange={() => {}}
          description={`help${'\n'}text`}
          placeholder={`type${'\0'}here`}
        />
        <SelectField
          label={`Mode${'\n'}Y`}
          value="a"
          onChange={() => {}}
          options={[
            { value: 'a', label: `Alpha${'\0'}` },
            { value: `bad${'\n'}key`, label: 'Evil' },
            { value: 'b', label: 'Beta' },
          ]}
        />
        <CheckboxField
          label={`Enable${'\0'}`}
          value={false}
          onChange={() => {}}
          description={`flag${'\n'}line`}
        />
      </>,
    );

    expect(screen.getByText('NameX')).toBeInTheDocument();
    expect(screen.getByText(/help text/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('typehere')).toBeInTheDocument();
    expect(screen.getByText(/Mode Y/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Evil' })).not.toBeInTheDocument();
    expect(screen.getByText('Enable')).toBeInTheDocument();
    expect(screen.getByText(/flag line/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });
});
