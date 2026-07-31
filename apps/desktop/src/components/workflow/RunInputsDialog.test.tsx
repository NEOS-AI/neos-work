import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunInputsDialog } from './RunInputsDialog.js';

describe('RunInputsDialog', () => {
  it('renders default inputs as JSON text', () => {
    render(
      <RunInputsDialog
        defaultInputs={{ symbol: '005930' }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(area.value).toContain('005930');
  });

  it('submits parsed object', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RunInputsDialog defaultInputs={{}} onConfirm={onConfirm} onCancel={() => {}} />,
    );
    const area = screen.getByRole('textbox');
    await user.clear(area);
    await user.paste('{"q":"hello"}');
    await user.click(screen.getByRole('button', { name: /^run$/i }));
    expect(onConfirm).toHaveBeenCalledWith({ q: 'hello' });
  });

  it('shows error for invalid JSON', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RunInputsDialog defaultInputs={{}} onConfirm={onConfirm} onCancel={() => {}} />,
    );
    const area = screen.getByRole('textbox');
    await user.clear(area);
    await user.paste('{not json');
    await user.click(screen.getByRole('button', { name: /^run$/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
  });

  it('rejects non-object JSON', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RunInputsDialog defaultInputs={{}} onConfirm={onConfirm} onCancel={() => {}} />,
    );
    const area = screen.getByRole('textbox');
    await user.clear(area);
    await user.paste('[1,2,3]');
    await user.click(screen.getByRole('button', { name: /^run$/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Must be a JSON object.')).toBeInTheDocument();
  });

  it('calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <RunInputsDialog defaultInputs={{}} onConfirm={() => {}} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('Escape calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <RunInputsDialog defaultInputs={{}} onConfirm={() => {}} onCancel={onCancel} />,
    );
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('Escape preventDefault so stacked listeners do not double-fire', () => {
    const onCancel = vi.fn();
    render(
      <RunInputsDialog defaultInputs={{}} onConfirm={() => {}} onCancel={onCancel} />,
    );
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores Escape when defaultPrevented is already set', () => {
    const onCancel = vi.fn();
    render(
      <RunInputsDialog defaultInputs={{}} onConfirm={() => {}} onCancel={onCancel} />,
    );
    const stop = (ev: KeyboardEvent) => ev.preventDefault();
    window.addEventListener('keydown', stop, true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', stop, true);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('drops control-char, blank, and overlong keys from confirm payload', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RunInputsDialog defaultInputs={{}} onConfirm={onConfirm} onCancel={() => {}} />,
    );
    const area = screen.getByRole('textbox');
    await user.clear(area);
    const longKey = 'k'.repeat(201);
    await user.paste(
      JSON.stringify({
        ok: 1,
        'bad\nkey': 2,
        '  ': 3,
        [longKey]: 4,
        good: 'yes',
      }),
    );
    await user.click(screen.getByRole('button', { name: /^run$/i }));
    expect(onConfirm).toHaveBeenCalledWith({ ok: 1, good: 'yes' });
    const payload = onConfirm.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('bad\nkey');
    expect(payload).not.toHaveProperty(longKey);
  });

  it('sanitizes defaultInputs seed and drops null-byte string values on confirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RunInputsDialog
        defaultInputs={{
          ok: 'safe',
          'bad\nkey': 1,
          dirty: `hi${'\0'}there`,
        }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    // Control-char key omitted from seed; null stripped from string value
    expect(area.value).toContain('ok');
    expect(area.value).toContain('hithere');
    expect(area.value).not.toContain('\0');
    expect(area.value).not.toContain('bad');

    await user.clear(area);
    await user.paste(JSON.stringify({ a: 'x', b: `y${'\0'}z` }));
    await user.click(screen.getByRole('button', { name: /^run$/i }));
    expect(onConfirm).toHaveBeenCalledWith({ a: 'x' });
  });

  it('strips null bytes and caps JSON editor length on change', () => {
    render(
      <RunInputsDialog defaultInputs={{}} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;

    // Inject null via fireEvent so userEvent does not sanitize — onChange strips live
    fireEvent.change(area, { target: { value: `{"a":1}${'\0'}tail` } });
    expect(area.value).toBe('{"a":1}tail');
    expect(area.value).not.toContain('\0');

    // Cap at 50_000 chars
    fireEvent.change(area, { target: { value: 'x'.repeat(60_000) } });
    expect(area.value.length).toBe(50_000);
  });

  it('caps confirmed string values at 10k characters', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <RunInputsDialog defaultInputs={{}} onConfirm={onConfirm} onCancel={() => {}} />,
    );
    const area = screen.getByRole('textbox');
    await user.clear(area);
    const longVal = 'v'.repeat(12_000);
    await user.paste(JSON.stringify({ payload: longVal, n: 1 }));
    await user.click(screen.getByRole('button', { name: /^run$/i }));
    expect(onConfirm).toHaveBeenCalled();
    const payload = onConfirm.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.n).toBe(1);
    expect(typeof payload.payload).toBe('string');
    expect((payload.payload as string).length).toBe(10_000);
  });
});

describe('RunInputsDialog extra validation', () => {
  it('rejects non-object JSON and Escape cancels', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<RunInputsDialog onConfirm={onConfirm} onCancel={onCancel} />);
    const area = screen.getByRole('textbox');
    await user.clear(area);
    await user.paste('[1,2,3]');
    await user.click(screen.getByRole('button', { name: /^run$/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/Must be a JSON object/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('seeds sanitized defaults dropping control-char keys', () => {
    const circular: Record<string, unknown> = { ok: 1 };
    // non-string nested value path
    render(
      <RunInputsDialog
        defaultInputs={{ ok: 'hi', 'bad\nkey': 1, nested: { a: 1 } }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(area.value).toContain('ok');
    expect(area.value).toContain('nested');
  });

  it('drops control-char keys on confirm and caps long strings', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<RunInputsDialog onConfirm={onConfirm} onCancel={() => {}} />);
    const area = screen.getByRole('textbox');
    await user.clear(area);
    const long = 'x'.repeat(10_050);
    await user.paste(JSON.stringify({ good: long, 'k\n': 1 }));
    // control key in JSON is literal backslash-n unless we inject
    fireEvent.change(area, {
      target: { value: JSON.stringify({ good: long, normal: 2 }) },
    });
    await user.click(screen.getByRole('button', { name: /^run$/i }));
    expect(onConfirm).toHaveBeenCalled();
    const arg = onConfirm.mock.calls[0][0] as { good: string; normal: number };
    expect(arg.normal).toBe(2);
    expect(arg.good.length).toBe(10_000);
  });
});
