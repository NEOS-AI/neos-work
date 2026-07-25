import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GenUIForm } from './GenUIForm.js';

describe('GenUIForm', () => {
  it('renders text, select, and textarea fields', () => {
    render(
      <GenUIForm
        schema={{
          fields: [
            { key: 'name', label: 'Name', type: 'text', placeholder: 'Ada' },
            { key: 'tone', label: 'Tone', type: 'select', options: ['formal', 'casual'] },
            { key: 'notes', label: 'Notes', type: 'textarea' },
          ],
        }}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Tone')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ada')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
  });

  it('submits collected values', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <GenUIForm
        schema={{
          fields: [
            { key: 'name', label: 'Name', type: 'text', placeholder: 'name-ph' },
            { key: 'tone', label: 'Tone', type: 'select', options: ['formal', 'casual'] },
          ],
        }}
        onSubmit={onSubmit}
      />,
    );
    await user.type(screen.getByPlaceholderText('name-ph'), 'Ada');
    await user.selectOptions(screen.getByRole('combobox'), 'casual');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ada', tone: 'casual' });
  });

  it('trims submitted values and handles empty schema', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <GenUIForm
        schema={{
          fields: [{ key: 'name', label: 'Name', type: 'text', placeholder: 'name-ph' }],
        }}
        onSubmit={onSubmit}
      />,
    );
    await user.type(screen.getByPlaceholderText('name-ph'), '  Ada  ');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ada' });

    render(<GenUIForm schema={{ fields: [] }} onSubmit={() => {}} />);
    expect(screen.getByText(/No form fields/i)).toBeInTheDocument();
  });

  it('submits textarea values', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <GenUIForm
        schema={{
          fields: [{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'notes-ph' }],
        }}
        onSubmit={onSubmit}
      />,
    );
    await user.type(screen.getByPlaceholderText('notes-ph'), 'line one');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith({ notes: 'line one' });
  });

  it('submits empty values for empty schema fields', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <GenUIForm
        schema={{ fields: [{ key: 'x', label: 'X', type: 'text' }] }}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith({ x: '' });
  });

  it('drops control-char field keys from submit payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <GenUIForm
        schema={{
          fields: [
            { key: 'ok', label: 'Ok', type: 'text', placeholder: 'ok-ph' },
            { key: 'bad\nkey', label: 'Bad', type: 'text', placeholder: 'bad-ph' },
          ],
        }}
        onSubmit={onSubmit}
      />,
    );
    await user.type(screen.getByPlaceholderText('ok-ph'), 'yes');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith({ ok: 'yes' });
  });

  it('drops null-byte field values and overlong keys from submit payload', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const longKey = 'k'.repeat(201);
    render(
      <GenUIForm
        schema={{
          fields: [
            { key: 'safe', label: 'Safe', type: 'text', placeholder: 'safe-ph' },
            { key: 'tainted', label: 'Tainted', type: 'text', placeholder: 'tainted-ph' },
            { key: longKey, label: 'Long', type: 'text', placeholder: 'long-ph' },
          ],
        }}
        onSubmit={onSubmit}
      />,
    );
    await user.type(screen.getByPlaceholderText('safe-ph'), 'keep');
    // Inject null via fireEvent so userEvent does not sanitize
    const tainted = screen.getByPlaceholderText('tainted-ph') as HTMLInputElement;
    fireEvent.change(tainted, { target: { value: `bad${'\0'}val` } });
    await user.type(screen.getByPlaceholderText('long-ph'), 'ignored');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith({ safe: 'keep' });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('tainted');
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty(longKey);
  });
});
