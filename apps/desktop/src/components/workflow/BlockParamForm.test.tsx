import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockParamForm } from './BlockParamForm.js';
import type { WorkflowBlock } from '../../lib/engine.js';

// Minimal mock block factory
function makeBlock(paramDefs: WorkflowBlock['paramDefs']): WorkflowBlock {
  return {
    id: 'test-block',
    name: 'Test Block',
    description: '',
    category: 'test',
    domain: 'general',
    isBuiltIn: false,
    implementationType: 'native',
    inputDescription: '',
    outputDescription: '',
    paramDefs,
  };
}

describe('BlockParamForm', () => {
  it('shows "no editable parameters" message for empty paramDefs', () => {
    render(<BlockParamForm block={makeBlock([])} value={{}} onChange={() => {}} />);
    expect(screen.getByText(/no editable parameters/i)).toBeInTheDocument();
  });

  it('renders a text input for string param', () => {
    const block = makeBlock([{ key: 'url', type: 'string', label: 'URL' }]);
    render(<BlockParamForm block={block} value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText(/URL/i)).toBeInTheDocument();
  });

  it('renders a number input for number param', () => {
    const block = makeBlock([{ key: 'count', type: 'number', label: 'Count' }]);
    render(<BlockParamForm block={block} value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText(/Count/i)).toBeInTheDocument();
  });

  it('renders a checkbox for boolean param', () => {
    const block = makeBlock([{ key: 'enabled', type: 'boolean', label: 'Enabled' }]);
    render(<BlockParamForm block={block} value={{}} onChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('calls onChange when text input changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const block = makeBlock([{ key: 'query', type: 'string', label: 'Query' }]);
    render(<BlockParamForm block={block} value={{}} onChange={onChange} />);
    const input = screen.getByLabelText(/Query/i);
    await user.type(input, 'hello');
    expect(onChange).toHaveBeenCalled();
    // Last call should contain the new value
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall.query).toBe('o'); // last char typed
  });

  it('renders select for select param', () => {
    const block = makeBlock([{ key: 'lang', type: 'select', label: 'Language', options: ['en', 'ko'] }]);
    render(<BlockParamForm block={block} value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText(/Language/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('calls onChange when select and checkbox change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const block = makeBlock([
      { key: 'lang', type: 'select', label: 'Language', options: ['en', 'ko'] },
      { key: 'flag', type: 'boolean', label: 'Flag' },
    ]);
    render(
      <BlockParamForm
        block={block}
        value={{ lang: 'en', flag: false }}
        onChange={onChange}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox'), 'ko');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lang: 'ko' }));

    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ flag: true }));
  });

  it('calls onChange with number values when controlled state updates', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const block = makeBlock([{ key: 'n', type: 'number', label: 'Count' }]);

    function Harness() {
      const [value, setValue] = React.useState<Record<string, unknown>>({ n: 1 });
      return (
        <BlockParamForm
          block={block}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Harness />);
    const num = screen.getByLabelText(/Count/i);
    await user.clear(num);
    await user.type(num, '5');
    expect(onChange.mock.calls.some((c) => c[0].n === 5)).toBe(true);
  });
});
