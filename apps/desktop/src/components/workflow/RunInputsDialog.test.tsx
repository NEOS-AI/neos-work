import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
