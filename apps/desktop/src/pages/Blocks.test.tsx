import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listBlocks = vi.fn();
const createBlock = vi.fn();
const updateBlock = vi.fn();
const deleteBlock = vi.fn();

const client = { listBlocks, createBlock, updateBlock, deleteBlock };

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({ client }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));

const { Blocks } = await import('./Blocks.js');

const blocks = [
  {
    id: 'price_lookup',
    name: 'Price Lookup',
    domain: 'finance' as const,
    category: 'market',
    description: 'Lookup price',
    isBuiltIn: true,
    implementationType: 'native' as const,
    paramDefs: [],
    inputDescription: '',
    outputDescription: '',
  },
  {
    id: 'my_custom',
    name: 'Custom Block',
    domain: 'general' as const,
    category: 'custom',
    description: 'User block',
    isBuiltIn: false,
    implementationType: 'prompt' as const,
    promptTemplate: 'Do {{x}}',
    paramDefs: [{ key: 'x', label: 'X', type: 'string' }],
    inputDescription: 'in',
    outputDescription: 'out',
  },
];

describe('Blocks page', () => {
  beforeEach(() => {
    listBlocks.mockReset();
    createBlock.mockReset();
    updateBlock.mockReset();
    deleteBlock.mockReset();
    localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows empty state', async () => {
    listBlocks.mockResolvedValue({ ok: true, data: [] });
    render(<Blocks />);
    await waitFor(() => {
      expect(screen.getByText(/No blocks found/)).toBeInTheDocument();
    });
  });

  it('lists blocks and filters by domain/source/search', async () => {
    const user = userEvent.setup();
    listBlocks.mockResolvedValue({ ok: true, data: blocks });
    render(<Blocks />);

    await waitFor(() => expect(screen.getByText('Price Lookup')).toBeInTheDocument());
    expect(screen.getByText('Custom Block')).toBeInTheDocument();
    expect(screen.getByText('built-in')).toBeInTheDocument();
    // section/chip/impl all include "Built-in"
    expect(screen.getAllByText(/Built-in/).length).toBeGreaterThan(0);
    expect(screen.getByText('Prompt')).toBeInTheDocument();

    // domain finance
    await user.click(screen.getByRole('button', { name: 'finance' }));
    expect(screen.getByText('Price Lookup')).toBeInTheDocument();
    expect(screen.queryByText('Custom Block')).not.toBeInTheDocument();

    // reset domain
    await user.click(screen.getByRole('button', { name: 'all' }));
    // source Custom
    await user.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getByText('Custom Block')).toBeInTheDocument();
    expect(screen.queryByText('Price Lookup')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByPlaceholderText('Search blocks…'), 'Custom');
    expect(screen.getByText('Custom Block')).toBeInTheDocument();
    expect(screen.queryByText('Price Lookup')).not.toBeInTheDocument();
  });

  it('creates a prompt block via modal', async () => {
    listBlocks
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValue({ ok: true, data: blocks });
    createBlock.mockResolvedValue({ ok: true });
    render(<Blocks />);

    await waitFor(() => expect(screen.getByRole('button', { name: '+ New Block' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '+ New Block' }));

    // modal fields: ID, Name, prompt template required
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument());

    const inputs = Array.from(document.querySelectorAll('input, textarea')) as HTMLInputElement[];
    // Heuristic fill: first empty text inputs get id/name, textarea gets prompt
    let filledId = false;
    let filledName = false;
    for (const input of inputs) {
      if (input.tagName === 'TEXTAREA') {
        fireEvent.change(input, { target: { value: 'Prompt body {{x}}' } });
        continue;
      }
      if (input.type === 'search') continue;
      if (!filledId && !input.value) {
        fireEvent.change(input, { target: { value: 'my_block' } });
        filledId = true;
        continue;
      }
      if (!filledName && !input.value) {
        fireEvent.change(input, { target: { value: 'My Block' } });
        filledName = true;
      }
    }

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(createBlock).toHaveBeenCalled();
      const arg = createBlock.mock.calls[0]![0] as { id: string; name: string; promptTemplate?: string };
      expect(arg.id).toBe('my_block');
      expect(arg.name).toBe('My Block');
      expect(arg.promptTemplate).toContain('Prompt');
    });
  });

  it('rejects control-char name/id without calling API', async () => {
    listBlocks.mockResolvedValue({ ok: true, data: [] });
    render(<Blocks />);
    await waitFor(() => expect(screen.getByRole('button', { name: '+ New Block' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '+ New Block' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('my_custom_block'), {
      target: { value: 'valid_id' },
    });
    fireEvent.change(screen.getByPlaceholderText('My Custom Block'), {
      target: { value: `bad${'\0'}name` },
    });
    for (const ta of Array.from(document.querySelectorAll('textarea'))) {
      fireEvent.change(ta, { target: { value: 'Prompt body' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Name or ID contains invalid control characters')).toBeInTheDocument();
    expect(createBlock).not.toHaveBeenCalled();

    // ID input sanitizes non [a-z0-9_] to underscores (control chars never reach validation)
    fireEvent.change(screen.getByPlaceholderText('my_custom_block'), {
      target: { value: `bad${'\0'}id` },
    });
    expect((screen.getByPlaceholderText('my_custom_block') as HTMLInputElement).value).toBe('bad_id');
    fireEvent.change(screen.getByPlaceholderText('My Custom Block'), {
      target: { value: 'Valid Name' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(createBlock).toHaveBeenCalledWith(expect.objectContaining({ id: 'bad_id', name: 'Valid Name' }));
    });
  });

  it('requires id, name, and prompt template when creating a prompt block', async () => {
    listBlocks.mockResolvedValue({ ok: true, data: [] });
    render(<Blocks />);
    await waitFor(() => expect(screen.getByRole('button', { name: '+ New Block' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '+ New Block' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(createBlock).not.toHaveBeenCalled();

    // Fill id + name, leave prompt empty → prompt template required
    let filled = 0;
    for (const input of Array.from(document.querySelectorAll('input')) as HTMLInputElement[]) {
      if (input.type === 'search') continue;
      if (!input.value && filled < 2) {
        fireEvent.change(input, {
          target: { value: filled === 0 ? 'id_only' : 'Has Name' },
        });
        filled++;
      }
    }
    expect(filled).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Prompt template is required')).toBeInTheDocument();
    expect(createBlock).not.toHaveBeenCalled();
  });

  it('deletes a custom block', async () => {
    listBlocks.mockResolvedValue({ ok: true, data: blocks });
    deleteBlock.mockResolvedValue({ ok: true });
    render(<Blocks />);
    await waitFor(() => expect(screen.getByText('Custom Block')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteBlock).toHaveBeenCalledWith('my_custom'));
  });

  it('cancels delete when confirm is false and shows no-match filter', async () => {
    const user = userEvent.setup();
    listBlocks.mockResolvedValue({ ok: true, data: blocks });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Blocks />);
    await waitFor(() => expect(screen.getByText('Custom Block')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(deleteBlock).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText('Search blocks…'), 'zzzz-none');
    expect(screen.queryByText('Custom Block')).not.toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });

  it('Escape closes modal and clears search', async () => {
    const user = userEvent.setup();
    listBlocks.mockResolvedValue({ ok: true, data: blocks });
    render(<Blocks />);
    await waitFor(() => expect(screen.getByText('Custom Block')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    });

    const search = screen.getByPlaceholderText('Search blocks…');
    await user.type(search, 'zz');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((search as HTMLInputElement).value).toBe('');
    });
  });

  it('edits a custom block via updateBlock and validates required name', async () => {
    listBlocks.mockResolvedValue({ ok: true, data: blocks });
    updateBlock.mockResolvedValue({ ok: true });
    render(<Blocks />);
    await waitFor(() => expect(screen.getByText('Custom Block')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument());
    expect(screen.getByText('Edit Block')).toBeInTheDocument();

    // Clear name → validation error, no API call
    const nameInput = screen.getByDisplayValue('Custom Block') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(updateBlock).not.toHaveBeenCalled();

    fireEvent.change(nameInput, { target: { value: 'Custom Block Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(updateBlock).toHaveBeenCalledWith(
        'my_custom',
        expect.objectContaining({ name: 'Custom Block Renamed' }),
      );
    });
  });

  it('rejects control-char category and null-byte description without calling API', async () => {
    listBlocks.mockResolvedValue({ ok: true, data: [] });
    render(<Blocks />);
    await waitFor(() => expect(screen.getByRole('button', { name: '+ New Block' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '+ New Block' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('my_custom_block'), { target: { value: 'ok_block' } });
    fireEvent.change(screen.getByPlaceholderText('My Custom Block'), { target: { value: 'Ok Name' } });
    // Use null byte — single-line inputs may strip bare newlines
    fireEvent.change(screen.getByPlaceholderText('custom'), { target: { value: `cat${'\0'}bad` } });
    fireEvent.change(screen.getByPlaceholderText(/You are a helpful assistant/), {
      target: { value: 'Prompt body' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Category contains invalid control characters')).toBeInTheDocument();
    expect(createBlock).not.toHaveBeenCalled();

    // Fix category, put null byte in description
    fireEvent.change(screen.getByPlaceholderText('custom'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByPlaceholderText('What does this block do?'), {
      target: { value: `desc${'\0'}bad` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Fields contain invalid control characters')).toBeInTheDocument();
    expect(createBlock).not.toHaveBeenCalled();
  });

  it('surfaces createBlock errors in the modal', async () => {
    listBlocks.mockResolvedValue({ ok: true, data: [] });
    createBlock.mockRejectedValue(new Error('duplicate block id'));
    render(<Blocks />);
    await waitFor(() => expect(screen.getByRole('button', { name: '+ New Block' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '+ New Block' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('my_custom_block'), { target: { value: 'dup_block' } });
    fireEvent.change(screen.getByPlaceholderText('My Custom Block'), { target: { value: 'Dup' } });
    fireEvent.change(screen.getByPlaceholderText(/You are a helpful assistant/), {
      target: { value: 'Prompt {{x}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createBlock).toHaveBeenCalled());
    expect(await screen.findByText('duplicate block id')).toBeInTheDocument();
    // Modal stays open for correction
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('scrubs control-char createBlock error messages in the modal', async () => {
    listBlocks.mockResolvedValue({ ok: true, data: [] });
    createBlock.mockRejectedValue(
      new Error('dup' + String.fromCharCode(0) + 'id' + String.fromCharCode(10) + 'x'),
    );
    render(<Blocks />);
    await waitFor(() => expect(screen.getByRole('button', { name: '+ New Block' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '+ New Block' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('my_custom_block'), { target: { value: 'ctrl_err' } });
    fireEvent.change(screen.getByPlaceholderText('My Custom Block'), { target: { value: 'Ctrl' } });
    fireEvent.change(screen.getByPlaceholderText(/You are a helpful assistant/), {
      target: { value: 'Prompt {{x}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createBlock).toHaveBeenCalled());
    expect(await screen.findByText('dupid x')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('filters built-in vs custom source and drops control-char param keys on save', async () => {
    const user = userEvent.setup();
    listBlocks.mockResolvedValue({ ok: true, data: blocks });
    updateBlock.mockResolvedValue({ ok: true });
    render(<Blocks />);
    await waitFor(() => expect(screen.getByText('Custom Block')).toBeInTheDocument());

    // Source filter: Built-in only
    await user.click(screen.getByRole('button', { name: 'Built-in' }));
    expect(screen.getByText('Price Lookup')).toBeInTheDocument();
    expect(screen.queryByText('Custom Block')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Custom' }));
    expect(screen.getByText('Custom Block')).toBeInTheDocument();
    expect(screen.queryByText('Price Lookup')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument());

    // Add a param with control-char key (should be dropped on save)
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    const keyInputs = Array.from(document.querySelectorAll('input[placeholder="key"]')) as HTMLInputElement[];
    const lastKey = keyInputs[keyInputs.length - 1]!;
    fireEvent.change(lastKey, { target: { value: `bad${'\0'}key` } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateBlock).toHaveBeenCalled());
    const payload = updateBlock.mock.calls.at(-1)![1] as { paramDefs: { key: string }[] };
    expect(payload.paramDefs.every((p) => !/[\0\r\n]/.test(p.key))).toBe(true);
    expect(payload.paramDefs.some((p) => p.key === 'x')).toBe(true);
    expect(payload.paramDefs.some((p) => p.key.includes('bad'))).toBe(false);
  });

  it('scrubs control chars from block card name, domain, id, description, and type', async () => {
    listBlocks.mockResolvedValue({
      ok: true,
      data: [
        {
          id: `blk${'\0'}id`,
          name: `Evil${'\0'}Block`,
          domain: `coding${'\n'}x`,
          category: 'custom',
          description: `does${'\n'}things`,
          isBuiltIn: false,
          implementationType: `prompt${'\n'}x`,
          paramDefs: [],
          inputDescription: '',
          outputDescription: '',
        },
      ],
    });
    render(<Blocks />);
    await waitFor(() => expect(screen.getByText('EvilBlock')).toBeInTheDocument());
    expect(screen.getByText(/coding x/)).toBeInTheDocument();
    expect(screen.getByText(/blkid/)).toBeInTheDocument();
    expect(screen.getByText(/does things/)).toBeInTheDocument();
    expect(screen.getByText(/prompt x/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });
});
