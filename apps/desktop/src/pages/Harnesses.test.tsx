import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listWorkers = vi.fn();
const createWorker = vi.fn();
const updateWorker = vi.fn();
const deleteWorker = vi.fn();

const client = { listWorkers, createWorker, updateWorker, deleteWorker };

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({ client }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) =>
      opts?.name ? `${key}:${opts.name}` : key,
  }),
}));

const { Harnesses, Workers } = await import('./Harnesses.js');

const workers = [
  {
    id: 'h-custom',
    name: 'Custom Analyst',
    domain: 'finance' as const,
    description: 'Custom worker',
    systemPrompt: 'You analyze finance',
    allowedTools: ['web_search', 'read_file'],
    isBuiltIn: false,
    permissionProfile: 'network' as const,
    defaultMode: 'solo' as const,
    workspace: { kind: 'run' as const },
  },
  {
    id: 'coding_reviewer',
    name: 'Code Reviewer',
    domain: 'coding' as const,
    description: 'Built-in review',
    systemPrompt: 'Review code',
    allowedTools: ['read_file'],
    isBuiltIn: true,
    permissionProfile: 'read_only' as const,
    defaultMode: 'solo' as const,
  },
];

describe('Workers page (Domain Workers /harnesses alias)', () => {
  it('exports Workers as primary and Harnesses as alias', () => {
    expect(Workers).toBe(Harnesses);
  });
  beforeEach(() => {
    listWorkers.mockReset();
    createWorker.mockReset();
    updateWorker.mockReset();
    deleteWorker.mockReset();
    localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows loading then empty', async () => {
    listWorkers.mockResolvedValue({ ok: true, data: [] });
    render(<Harnesses />);
    expect(screen.getByText('common.loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('harness.empty')).toBeInTheDocument();
    });
  });

  it('shows scrubbed load error when listWorkers fails', async () => {
    listWorkers.mockResolvedValue({
      ok: false,
      error: `worker${'\n'}down${'\0'}!`,
    });
    render(<Harnesses />);
    await waitFor(() => {
      expect(screen.getByText('worker down!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('lists workers and filters by domain/search', async () => {
    const user = userEvent.setup();
    listWorkers.mockResolvedValue({ ok: true, data: workers });
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
    await user.type(screen.getByPlaceholderText('Search workers…'), 'Review');
    expect(screen.getByText('Code Reviewer')).toBeInTheDocument();
    expect(screen.queryByText('Custom Analyst')).not.toBeInTheDocument();
  });

  it('creates a custom worker via modal (workers API + v0.4 fields)', async () => {
    listWorkers
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValue({ ok: true, data: workers });
    createWorker.mockResolvedValue({ ok: true, data: workers[0] });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('harness.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByText('harness.createTitle')).toBeInTheDocument());

    const allInputs = screen.getAllByRole('textbox');
    for (const input of allInputs) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if (el.tagName === 'TEXTAREA' || el.getAttribute('rows')) {
        fireEvent.change(el, { target: { value: 'System prompt here' } });
      } else if (!el.value && el.placeholder !== 'web_search, read_file, ...') {
        fireEvent.change(el, { target: { value: 'My Worker' } });
      }
    }
    const textareas = document.querySelectorAll('textarea');
    if (textareas[0]) fireEvent.change(textareas[0], { target: { value: 'System prompt here' } });

    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    await waitFor(() => {
      expect(createWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Worker',
          systemPrompt: 'System prompt here',
          permissionProfile: expect.any(String),
          defaultMode: expect.any(String),
          workspace: expect.objectContaining({ kind: expect.any(String) }),
        }),
      );
    });
  });

  it('rejects control-char name without calling API', async () => {
    listWorkers.mockResolvedValue({ ok: true, data: [] });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('harness.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByText('harness.createTitle')).toBeInTheDocument());

    const textareas = document.querySelectorAll('textarea');
    if (textareas[0]) fireEvent.change(textareas[0], { target: { value: 'System prompt' } });
    for (const input of screen.getAllByRole('textbox')) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if (el.tagName === 'TEXTAREA') continue;
      if (!el.value && el.placeholder !== 'web_search, read_file, ...') {
        fireEvent.change(el, { target: { value: `bad${'\0'}name` } });
        break;
      }
    }
    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    expect(createWorker).not.toHaveBeenCalled();
    expect(screen.getByText('Name contains invalid control characters')).toBeInTheDocument();
  });

  it('deletes custom worker but not built-in', async () => {
    listWorkers.mockResolvedValue({ ok: true, data: workers });
    deleteWorker.mockResolvedValue({ ok: true });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: 'common.view' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteWorker).toHaveBeenCalledWith('h-custom'));
  });

  it('alerts scrubbed worker delete API errors', async () => {
    listWorkers.mockResolvedValue({ ok: true, data: workers });
    deleteWorker.mockResolvedValue({
      ok: false,
      error: `still${'\n'}linked${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    await waitFor(() => {
      expect(deleteWorker).toHaveBeenCalledWith('h-custom');
      expect(window.alert).toHaveBeenCalledWith('still linked!');
    });
  });

  it('alerts scrubbed error when worker delete throws', async () => {
    listWorkers.mockResolvedValue({ ok: true, data: workers });
    deleteWorker.mockRejectedValue(new Error(`io${'\n'}err${'\0'}!`));
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    await waitFor(() => {
      expect(deleteWorker).toHaveBeenCalledWith('h-custom');
      expect(window.alert).toHaveBeenCalledWith('io err!');
    });
    expect(screen.getByText('Custom Analyst')).toBeInTheDocument();
  });

  it('keeps modal open and shows scrubbed create API error', async () => {
    listWorkers.mockResolvedValue({ ok: true, data: [] });
    createWorker.mockResolvedValue({
      ok: false,
      error: `id${'\n'}taken${'\0'}!`,
    });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('harness.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByText('harness.createTitle')).toBeInTheDocument());

    const allInputs = screen.getAllByRole('textbox');
    for (const input of allInputs) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if (el.tagName === 'TEXTAREA' || el.getAttribute('rows')) {
        fireEvent.change(el, { target: { value: 'System prompt here' } });
      } else if (!el.value && el.placeholder !== 'web_search, read_file, ...') {
        fireEvent.change(el, { target: { value: 'My Worker' } });
      }
    }
    const textareas = document.querySelectorAll('textarea');
    if (textareas[0]) fireEvent.change(textareas[0], { target: { value: 'System prompt here' } });

    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    await waitFor(() => {
      expect(createWorker).toHaveBeenCalled();
      expect(screen.getByText('id taken!')).toBeInTheDocument();
    });
    expect(screen.getByText('harness.createTitle')).toBeInTheDocument();
  });

  it('cancels delete when confirm is false', async () => {
    listWorkers.mockResolvedValue({ ok: true, data: workers });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    expect(deleteWorker).not.toHaveBeenCalled();
  });

  it('scrubs control-char worker name in delete confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    listWorkers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'h-del',
          name: 'Evil' + String.fromCharCode(0) + 'Worker' + String.fromCharCode(10) + 'X',
          domain: 'coding',
          description: 'd',
          systemPrompt: 'p',
          allowedTools: [],
          isBuiltIn: false,
        },
      ],
    });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText(/EvilWorker/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
    expect(confirmSpy).toHaveBeenCalled();
    const msg = String(confirmSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).toContain('harness.confirmDelete:');
    expect(msg).toContain('EvilWorker X');
    expect(msg).not.toContain('\0');
    expect(deleteWorker).not.toHaveBeenCalled();
  });

  it('Escape closes modal and clears search', async () => {
    const user = userEvent.setup();
    listWorkers.mockResolvedValue({ ok: true, data: workers });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByText('harness.createTitle')).toBeInTheDocument());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByText('harness.createTitle')).not.toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('Search workers…'), 'x');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search workers…') as HTMLInputElement).value).toBe('');
    });
  });

  it('edits a custom worker via updateWorker and views built-in read-only', async () => {
    listWorkers.mockResolvedValue({ ok: true, data: workers });
    updateWorker.mockResolvedValue({ ok: true });
    const { unmount } = render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    await waitFor(() => expect(screen.getByText('harness.editTitle')).toBeInTheDocument());

    const nameInput = screen.getByDisplayValue('Custom Analyst') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Custom Analyst v2' } });
    fireEvent.click(screen.getByRole('button', { name: /common\.save|Save/i }));
    await waitFor(() => {
      expect(updateWorker).toHaveBeenCalledWith(
        'h-custom',
        expect.objectContaining({
          name: 'Custom Analyst v2',
          systemPrompt: 'You analyze finance',
          permissionProfile: 'network',
          defaultMode: 'solo',
        }),
      );
    });
    unmount();

    updateWorker.mockClear();
    listWorkers.mockResolvedValue({ ok: true, data: workers });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Code Reviewer')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'common.view' }));
    await waitFor(() => expect(screen.getByText('harness.viewTitle')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /common\.save|Save/i })).not.toBeInTheDocument();
  });

  it('shows no-match filter empty state', async () => {
    const user = userEvent.setup();
    listWorkers.mockResolvedValue({ ok: true, data: workers });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Custom Analyst')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Search workers…'), 'zzzz-none');
    expect(screen.queryByText('Custom Analyst')).not.toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();
    expect(screen.getByText('No workers match filters')).toBeInTheDocument();
  });

  it('rejects blank required fields and null-byte prompt without calling API', async () => {
    listWorkers.mockResolvedValue({ ok: true, data: [] });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('harness.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByText('harness.createTitle')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    expect(createWorker).not.toHaveBeenCalled();
    expect(screen.getByText('harness.validationError')).toBeInTheDocument();

    for (const input of screen.getAllByRole('textbox')) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if (el.tagName === 'TEXTAREA') {
        fireEvent.change(el, { target: { value: `prompt${'\0'}bad` } });
      } else if (!el.value && el.placeholder !== 'web_search, read_file, ...') {
        fireEvent.change(el, { target: { value: 'Named' } });
      }
    }
    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    expect(createWorker).not.toHaveBeenCalled();
    expect(screen.getByText('Fields contain invalid control characters')).toBeInTheDocument();
  });

  it('surfaces createWorker errors and filters control-char tool tokens', async () => {
    listWorkers.mockResolvedValue({ ok: true, data: [] });
    createWorker.mockRejectedValue(new Error('id already exists'));
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('harness.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByText('harness.createTitle')).toBeInTheDocument());

    for (const input of screen.getAllByRole('textbox')) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if (el.tagName === 'TEXTAREA') {
        fireEvent.change(el, { target: { value: 'A valid system prompt' } });
      } else if (!el.value && el.placeholder !== 'web_search, read_file, ...') {
        fireEvent.change(el, { target: { value: 'Dup Worker' } });
      }
    }
    const toolsInput = screen.getByPlaceholderText('web_search, read_file, ...');
    fireEvent.change(toolsInput, {
      target: { value: `web_search, bad${'\0'}tool, read_file` },
    });

    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    await waitFor(() => {
      expect(createWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Dup Worker',
          allowedTools: ['web_search', 'read_file'],
        }),
      );
    });
    expect(await screen.findByText('id already exists')).toBeInTheDocument();
  });

  it('scrubs control chars from createWorker error banner', async () => {
    listWorkers.mockResolvedValue({ ok: true, data: [] });
    createWorker.mockRejectedValue(new Error(`id${'\n'}exists${'\0'}already`));
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('harness.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'harness.new' }));
    await waitFor(() => expect(screen.getByText('harness.createTitle')).toBeInTheDocument());

    for (const input of screen.getAllByRole('textbox')) {
      const el = input as HTMLInputElement | HTMLTextAreaElement;
      if (el.tagName === 'TEXTAREA') {
        fireEvent.change(el, { target: { value: 'A valid system prompt' } });
      } else if (!el.value && el.placeholder !== 'web_search, read_file, ...') {
        fireEvent.change(el, { target: { value: 'Dup Worker 2' } });
      }
    }

    fireEvent.click(screen.getByRole('button', { name: /common\.save|common\.create|Save|Create/i }));
    await waitFor(() => {
      expect(screen.getByText(/id existsalready/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('shows overflow tool count when more than four tools', async () => {
    listWorkers.mockResolvedValue({
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
    listWorkers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'h-scrub',
          name: `Evil${'\0'}Worker`,
          domain: `coding${'\n'}x`,
          description: `desc${'\n'}line`,
          systemPrompt: 'p',
          allowedTools: ['read_file', `bad${'\0'}tool`, '\nwrite', 'shell'],
          isBuiltIn: false,
        },
      ],
    });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('EvilWorker')).toBeInTheDocument());
    expect(screen.getByText(/coding x/)).toBeInTheDocument();
    expect(screen.getByText(/desc line/)).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('shell')).toBeInTheDocument();
    expect(screen.queryByText(/bad/)).not.toBeInTheDocument();
    expect(screen.queryByText('write')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('seeds edit modal with scrubbed name and filtered tools', async () => {
    listWorkers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: `h${'\0'}x`,
          name: `Evil${'\0'}Worker`,
          domain: 'coding' as const,
          description: `desc${'\0'}line`,
          systemPrompt: `You${'\0'} analyze`,
          allowedTools: ['read_file', `bad${'\0'}tool`, 'shell'],
          isBuiltIn: false,
          permissionProfile: 'execute' as const,
          defaultMode: 'solo' as const,
          workspace: { kind: 'isolated' as const },
        },
      ],
    });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('EvilWorker')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    await waitFor(() => expect(screen.getByText('harness.editTitle')).toBeInTheDocument());
    const nameInput = screen.getByDisplayValue('EvilWorker') as HTMLInputElement;
    expect(nameInput.value).not.toContain('\0');
    const toolsInput = screen.getByDisplayValue(/read_file/) as HTMLInputElement;
    expect(toolsInput.value).toContain('read_file');
    expect(toolsInput.value).toContain('shell');
    expect(toolsInput.value).not.toContain('bad');
    expect(toolsInput.value).not.toContain('\0');
  });

  it('shows coordinator badge for coordinator workers', async () => {
    listWorkers.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'general_coordinator',
          name: 'Coordinator',
          domain: 'general' as const,
          description: 'leader',
          systemPrompt: 'lead',
          allowedTools: [],
          isBuiltIn: true,
          defaultMode: 'coordinator' as const,
          permissionProfile: 'read_only' as const,
        },
      ],
    });
    render(<Harnesses />);
    await waitFor(() => expect(screen.getByText('Coordinator')).toBeInTheDocument());
    expect(screen.getByText('coordinator')).toBeInTheDocument();
    expect(screen.getByText('read_only')).toBeInTheDocument();
  });
});
