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

  it('deletes a custom block', async () => {
    listBlocks.mockResolvedValue({ ok: true, data: blocks });
    deleteBlock.mockResolvedValue({ ok: true });
    render(<Blocks />);
    await waitFor(() => expect(screen.getByText('Custom Block')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteBlock).toHaveBeenCalledWith('my_custom'));
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
});
