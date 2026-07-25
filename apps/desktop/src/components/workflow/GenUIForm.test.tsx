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
    // Overlong keys are not rendered
    expect(screen.queryByPlaceholderText('long-ph')).not.toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('safe-ph'), 'keep');
    // Inject null via fireEvent so userEvent does not sanitize
    const tainted = screen.getByPlaceholderText('tainted-ph') as HTMLInputElement;
    fireEvent.change(tainted, { target: { value: `bad${'\0'}val` } });
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith({ safe: 'keep' });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('tainted');
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty(longKey);
  });

  it('scrubs control-char field labels and omits control keys', async () => {
    const onSubmit = vi.fn();
    render(
      <GenUIForm
        schema={{
          fields: [
            { key: 'ok', label: 'Name' + String.fromCharCode(10) + 'X', type: 'text', placeholder: 'ph' + String.fromCharCode(0) + 'x' },
            { key: 'bad' + String.fromCharCode(10) + 'k', label: 'Hidden', type: 'text', placeholder: 'nope' },
            { key: 'tone', label: 'Tone', type: 'select', options: ['good', 'bad' + String.fromCharCode(0) + 'opt', String.fromCharCode(10) + 'lead'] },
          ],
        }}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.getByText('Name X')).toBeInTheDocument();
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('nope')).not.toBeInTheDocument();
    // placeholder null-byte stripped
    expect(screen.getByPlaceholderText('phx')).toBeInTheDocument();
    const select = screen.getByRole('combobox');
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(values).toContain('good');
    expect(values.some((v) => v.includes('\0') || v === 'lead')).toBe(false);
  });

});
