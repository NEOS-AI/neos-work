import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listHarnesses = vi.fn();
const createHarness = vi.fn();
const updateHarness = vi.fn();
const deleteHarness = vi.fn();

const client = { listHarnesses, createHarness, updateHarness, deleteHarness };

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({ client }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) =>
      opts?.name ? `${key}:${opts.name}` : key,
  }),
}));

const { Harnesses } = await import('./Harnesses.js');

const harnesses = [
  {
    id: 'h-custom',
    name: 'Custom Analyst',
    domain: 'finance' as const,
    description: 'Custom harness',
    systemPrompt: 'You analyze finance',
    allowedTools: ['web_search', 'read_file'],
    isBuiltIn: false,
  },
  {
    id: 'coding_reviewer',
    name: 'Code Reviewer',
    domain: 'coding' as const,
    description: 'Built-in review',
    systemPrompt: 'Review code',
    allowedTools: ['read_file'],
    isBuiltIn: true,
  },
];

describe('Harnesses page', () => {
  beforeEach(() => {
    listHarnesses.mockReset();
    createHarness.mockReset();
    updateHarness.mockReset();
    deleteHarness.mockReset();
    localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows loading then empty', async () => {
    listHarnesses.mockResolvedValue({ ok: true, data: [] });
    render(<Harnesses />);
    expect(screen.getByText('common.loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('harness.empty')).toBeInTheDocument();
    });
  });

  it('lists harnesses and filters by domain/search', async () => {
    const user = userEvent.setup();
    listHarnesses.mockResolvedValue({ ok: true, data: harnesses });
    render(<Harnesses />);

    await waitFor(() => expect(screen.getByText('Code Reviewer')).toBeInTheDocument());
    expect(screen.getByText('Custom Analyst')).toBeInTheDocument();
    expect(screen.getByText('built-in')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'finance' }));
    expect(screen.getByText('Custom Analyst')).toBeInTheDocument();
    expect(screen.queryByText('Code Reviewer')).not.toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'all' }));
    await user.type(screen.getByPlaceholderText('Search harnesses…'), 'Review');
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
    expect(screen.queryByText('Custom Analyst')).not.toBeInTheDocument();
  });

  it('creates a custom harness via modal', async () => {
    listHarnesses
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValue({ ok: true, data: harnesses });
    createHarness.mockResolvedValue({ ok: true, data: harnesses[0] });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('harness.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByPlaceholderText('my_harness_id')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('my_harness_id'), { target: { value: 'my_h' } });
    // name field - find by label text or inputs
    const inputs = document.querySelectorAll('input.modal-input, input[style], input');
    // fill remaining fields by placeholder / order
    const allInputs = screen.getAllByRole('textbox');
    // id already filled; name and description and systemPrompt and tools
    for (const input of allInputs) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if (el.placeholder === 'my_harness_id') continue;
      if (el.tagName === 'TEXTAREA' || el.getAttribute('rows')) {
        fireEvent.change(el, { target: { value: 'System prompt here' } });
      } else if (!el.value) {
        fireEvent.change(el, { target: { value: 'My Harness' } });
      }
    }

    // ensure system prompt set
    const textareas = document.querySelectorAll('textarea');
    if (textareas[0]) fireEvent.change(textareas[0], { target: { value: 'System prompt here' } });

    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    await waitFor(() => {
      expect(createHarness).toHaveBeenCalled();
    });
  });

  it('deletes custom harness but not built-in', async () => {
    listHarnesses.mockResolvedValue({ ok: true, data: harnesses });
    deleteHarness.mockResolvedValue({ ok: true });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());

    // built-in has view, custom has delete
    expect(screen.getByRole('button', { name: 'common.view' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteHarness).toHaveBeenCalledWith('h-custom'));
  });

  it('Escape closes modal and clears search', async () => {
    const user = userEvent.setup();
    listHarnesses.mockResolvedValue({ ok: true, data: harnesses });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByText('harness.createTitle')).toBeInTheDocument());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByText('harness.createTitle')).not.toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('Search harnesses…'), 'x');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search harnesses…') as HTMLInputElement).value).toBe('');
    });
  });
});
