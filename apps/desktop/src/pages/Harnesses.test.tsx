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

  it('rejects control-char id/name without calling API', async () => {
    listHarnesses.mockResolvedValue({ ok: true, data: [] });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('harness.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByPlaceholderText('my_harness_id')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('my_harness_id'), {
      target: { value: `bad${'\0'}id` },
    });
    const textareas = document.querySelectorAll('textarea');
    if (textareas[0]) fireEvent.change(textareas[0], { target: { value: 'System prompt' } });
    // fill other textboxes with a valid-looking name
    for (const input of screen.getAllByRole('textbox')) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if (el.placeholder === 'my_harness_id') continue;
      if (el.tagName === 'TEXTAREA') continue;
      if (!el.value) fireEvent.change(el, { target: { value: 'My Harness' } });
    }
    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    expect(createHarness).not.toHaveBeenCalled();
    expect(screen.getByText('harness.validationError')).toBeInTheDocument();
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

  it('cancels delete when confirm is false', async () => {
    listHarnesses.mockResolvedValue({ ok: true, data: harnesses });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    expect(deleteHarness).not.toHaveBeenCalled();
  });

  it('scrubs control-char harness name in delete confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    listHarnesses.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'h-del',
          name: 'Evil' + String.fromCharCode(0) + 'Harness' + String.fromCharCode(10) + 'X',
          domain: 'coding',
          description: 'd',
          systemPrompt: 'p',
          allowedTools: [],
          isBuiltIn: false,
        },
      ],
    });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText(/EvilHarness/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    expect(confirmSpy).toHaveBeenCalled();
    const msg = String(confirmSpy.mock.calls[0]?.[0] ?? '');
    // i18n mock formats as harness.confirmDelete:<name>
    expect(msg).toContain('harness.confirmDelete:');
    expect(msg).toContain('EvilHarness X');
    expect(msg).not.toContain('\0');
    expect(deleteHarness).not.toHaveBeenCalled();
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

  it('edits a custom harness via updateHarness and views built-in read-only', async () => {
    listHarnesses.mockResolvedValue({ ok: true, data: harnesses });
    updateHarness.mockResolvedValue({ ok: true });
    const { unmount } = render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    await waitFor(() => expect(screen.getByText('harness.editTitle')).toBeInTheDocument());

    const nameInput = screen.getByDisplayValue('Custom Analyst') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Custom Analyst v2' } });
    fireEvent.click(screen.getByRole('button', { name: /common\.save|Save/i }));
    await waitFor(() => {
      expect(updateHarness).toHaveBeenCalledWith(
        'h-custom',
        expect.objectContaining({
          name: 'Custom Analyst v2',
          systemPrompt: 'You analyze finance',
        }),
      );
    });
    unmount();

    // Built-in view is read-only (no save button)
    updateHarness.mockClear();
    listHarnesses.mockResolvedValue({ ok: true, data: harnesses });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Code Reviewer')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'common.view' }));
    await waitFor(() => expect(screen.getByText('harness.viewTitle')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /common\.save|Save/i })).not.toBeInTheDocument();
  });

  it('shows no-match filter empty state', async () => {
    const user = userEvent.setup();
    listHarnesses.mockResolvedValue({ ok: true, data: harnesses });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Search harnesses…'), 'zzzz-none');
    expect(screen.queryByText('Custom Analyst')).not.toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();
    expect(screen.getByText('No harnesses match filters')).toBeInTheDocument();
  });

  it('rejects blank required fields and null-byte prompt without calling API', async () => {
    listHarnesses.mockResolvedValue({ ok: true, data: [] });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('harness.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByPlaceholderText('my_harness_id')).toBeInTheDocument());

    // Empty save → validation error
    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    expect(createHarness).not.toHaveBeenCalled();
    expect(screen.getByText('harness.validationError')).toBeInTheDocument();

    // Fill id/name but null-byte system prompt
    fireEvent.change(screen.getByPlaceholderText('my_harness_id'), { target: { value: 'ok_id' } });
    for (const input of screen.getAllByRole('textbox')) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if (el.placeholder === 'my_harness_id') continue;
      if (el.tagName === 'TEXTAREA') {
        fireEvent.change(el, { target: { value: `prompt${'\0'}bad` } });
      } else if (!el.value) {
        fireEvent.change(el, { target: { value: 'Named' } });
      }
    }
    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    expect(createHarness).not.toHaveBeenCalled();
    expect(screen.getByText('harness.validationError')).toBeInTheDocument();
  });

  it('surfaces createHarness errors and filters control-char tool tokens', async () => {
    listHarnesses.mockResolvedValue({ ok: true, data: [] });
    createHarness.mockRejectedValue(new Error('id already exists'));
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('harness.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByPlaceholderText('my_harness_id')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('my_harness_id'), { target: { value: 'dup_h' } });
    for (const input of screen.getAllByRole('textbox')) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if (el.placeholder === 'my_harness_id') continue;
      if (el.tagName === 'TEXTAREA') {
        fireEvent.change(el, { target: { value: 'A valid system prompt' } });
      } else if (!el.value && el.placeholder !== 'web_search, read_file, ...') {
        fireEvent.change(el, { target: { value: 'Dup Harness' } });
      }
    }
    // Null-byte tool tokens are dropped before create
    const toolsInput = screen.getByPlaceholderText('web_search, read_file, ...');
    fireEvent.change(toolsInput, {
      target: { value: `web_search, bad${'\0'}tool, read_file` },
    });

    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    await waitFor(() => {
      expect(createHarness).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'dup_h',
          allowedTools: ['web_search', 'read_file'],
        }),
      );
    });
    expect(await screen.findByText('id already exists')).toBeInTheDocument();
  });

  it('scrubs control chars from createHarness error banner', async () => {
    listHarnesses.mockResolvedValue({ ok: true, data: [] });
    createHarness.mockRejectedValue(new Error(`id${'\n'}exists${'\0'}already`));
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('harness.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByPlaceholderText('my_harness_id')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('my_harness_id'), { target: { value: 'dup_h2' } });
    for (const input of screen.getAllByRole('textbox')) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if (el.placeholder === 'my_harness_id') continue;
      if (el.tagName === 'TEXTAREA') {
        fireEvent.change(el, { target: { value: 'A valid system prompt' } });
      } else if (!el.value && el.placeholder !== 'web_search, read_file, ...') {
        fireEvent.change(el, { target: { value: 'Dup Harness 2' } });
      }
    }

    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    await waitFor(() => {
      // null-byte stripped without inserting space; newline → space
      expect(screen.getByText(/id existsalready/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('shows overflow tool count when more than four tools', async () => {
    listHarnesses.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'many-tools',
          name: 'Many Tools',
          domain: 'general' as const,
          description: 'lots',
          systemPrompt: 'p',
          allowedTools: ['a', 'b', 'c', 'd', 'e', 'f'],
          isBuiltIn: false,
        },
      ],
    });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Many Tools')).toBeInTheDocument());
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.queryByText('e')).not.toBeInTheDocument();
  });

  it('scrubs control-char labels and omits control-char tools from chips', async () => {
    listHarnesses.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'h-scrub',
          name: `Evil${'\0'}Harness`,
          domain: `coding${'\n'}x`,
          description: `desc${'\n'}line`,
          systemPrompt: 'p',
          allowedTools: ['read_file', `bad${'\0'}tool`, '\nwrite', 'shell'],
          isBuiltIn: false,
        },
      ],
    });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('EvilHarness')).toBeInTheDocument());
    expect(screen.getByText(/coding x/)).toBeInTheDocument();
    expect(screen.getByText(/desc line/)).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('shell')).toBeInTheDocument();
    // control-char tools never become chips
    expect(screen.queryByText(/bad/)).not.toBeInTheDocument();
    expect(screen.queryByText('write')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });
});
