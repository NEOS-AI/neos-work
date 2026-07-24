import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
