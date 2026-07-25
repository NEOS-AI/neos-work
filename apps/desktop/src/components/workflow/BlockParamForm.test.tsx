import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('rejects null-byte string params and skips control-char select options', async () => {
    const onChange = vi.fn();
    const block = makeBlock([
      { key: 'query', type: 'string', label: 'Query' },
      {
        key: 'lang',
        type: 'select',
        label: 'Language',
        options: ['en', `bad${'\0'}opt`, '\nlead', 'ko'],
      },
      { key: `bad${'\0'}key`, type: 'string', label: 'Hidden' },
    ]);
    render(
      <BlockParamForm block={block} value={{ query: 'ok' }} onChange={onChange} />,
    );

    fireEvent.change(screen.getByDisplayValue('ok'), {
      target: { value: `q${'\0'}x` },
    });
    expect(onChange).not.toHaveBeenCalled();

    expect(screen.queryByLabelText(/Hidden/i)).not.toBeInTheDocument();

    const select = screen.getByLabelText(/Language/i);
    const optionValues = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(optionValues).toContain('en');
    expect(optionValues).toContain('ko');
    expect(optionValues).not.toContain('lead');
    expect(optionValues.some((v) => v.includes('\0'))).toBe(false);
  });

  it('reads/writes padded param keys via trimmed key (align defaultsForBlock)', async () => {
    const onChange = vi.fn();
    const block = makeBlock([{ key: '  url  ', type: 'string', label: 'URL' }]);
    // Value stored under trimmed key (as defaultsForBlock / BlockNode would)
    render(
      <BlockParamForm block={block} value={{ url: 'https://example.com' }} onChange={onChange} />,
    );
    expect(screen.getByDisplayValue('https://example.com')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('https://example.com'), {
      target: { value: 'https://next.example' },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://next.example' }),
    );
    // Must not invent a padded key in the map
    expect(onChange.mock.calls[0][0]).not.toHaveProperty('  url  ');
  });

  it('scrubs control-char param labels for display', () => {
    const block = makeBlock([
      { key: 'q', type: 'string', label: 'Query' + String.fromCharCode(10) + 'X', description: 'd' + String.fromCharCode(0) + 'esc' },
    ]);
    render(<BlockParamForm block={block} value={{}} onChange={() => {}} />);
    expect(screen.getByText('Query X')).toBeInTheDocument();
  });

  it('scrubs control-char param descriptions and falls back label to key', () => {
    const block = makeBlock([
      {
        key: 'timeout',
        type: 'number',
        // Control-only label → falls back to key
        label: String.fromCharCode(0) + String.fromCharCode(10),
        description: 'ms' + String.fromCharCode(10) + 'limit' + String.fromCharCode(0) + '!',
      },
    ]);
    render(<BlockParamForm block={block} value={{}} onChange={() => {}} />);
    expect(screen.getByText('timeout')).toBeInTheDocument();
    // description: LF collapsed to space; null-byte stripped
    expect(screen.getByText('ms limit!')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('caps select options at 100 and option labels at 200 chars', () => {
    const many = Array.from({ length: 120 }, (_, i) => `opt${i}`);
    const long = 'L'.repeat(250);
    const block = makeBlock([
      {
        key: 'mode',
        type: 'select',
        label: 'Mode',
        options: [long, ...many],
      },
    ]);
    render(<BlockParamForm block={block} value={{}} onChange={() => {}} />);
    const select = screen.getByLabelText(/Mode/i);
    // placeholder "Select..." + max 100 real options
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.length).toBeLessThanOrEqual(101);
    // Long option value is sliced to 200; label scrub uses same cap
    const longOpt = options.find((o) => (o as HTMLOptionElement).value.startsWith('L'));
    expect(longOpt).toBeTruthy();
    expect((longOpt as HTMLOptionElement).value.length).toBeLessThanOrEqual(200);
    expect((longOpt?.textContent ?? '').length).toBeLessThanOrEqual(200);
  });

});
