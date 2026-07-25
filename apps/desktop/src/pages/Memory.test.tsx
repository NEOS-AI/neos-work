import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listMemories = vi.fn();
const createMemory = vi.fn();
const updateMemory = vi.fn();
const deleteMemory = vi.fn();
const toggleMemory = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: { listMemories, createMemory, updateMemory, deleteMemory, toggleMemory },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const Memory = (await import('./Memory.js')).default;

const items = [
  {
    id: 'm1',
    name: 'User Pref',
    type: 'user' as const,
    content: 'likes dark mode',
    enabled: true,
    updatedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'm2',
    name: 'Skill Note',
    type: 'skill' as const,
    content: 'coding tips',
    enabled: false,
    updatedAt: '2026-01-15T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'm3',
    name: 'Session Scratch',
    type: 'session' as const,
    content: 'temp session note',
    enabled: true,
    updatedAt: '2026-01-20T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'm4',
    name: 'API Docs',
    type: 'reference' as const,
    content: 'reference material',
    enabled: true,
    updatedAt: '2026-01-10T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('Memory page', () => {
  beforeEach(() => {
    listMemories.mockReset();
    createMemory.mockReset();
    updateMemory.mockReset();
    deleteMemory.mockReset();
    toggleMemory.mockReset();
    localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows empty state', async () => {
    listMemories.mockResolvedValue({ ok: true, data: [] });
    render(<Memory />);
    await waitFor(() => {
      expect(screen.getByText('memory.empty')).toBeInTheDocument();
    });
  });

  it('lists items and filters by type/enabled/search', async () => {
    const user = userEvent.setup();
    listMemories.mockResolvedValue({ ok: true, data: items });
    render(<Memory />);

    await waitFor(() => expect(screen.getByText('User Pref')).toBeInTheDocument());
    expect(screen.getByText('Skill Note')).toBeInTheDocument();
    expect(screen.getByText('4/4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'user' }));
    expect(screen.getByText('User Pref')).toBeInTheDocument();
    expect(screen.queryByText('Skill Note')).not.toBeInTheDocument();
    expect(screen.getByText('1/4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'skill' }));
    expect(screen.getByText('Skill Note')).toBeInTheDocument();
    expect(screen.queryByText('User Pref')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'session' }));
    expect(screen.getByText('Session Scratch')).toBeInTheDocument();
    expect(screen.queryByText('Skill Note')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'reference' }));
    expect(screen.getByText('API Docs')).toBeInTheDocument();
    expect(screen.queryByText('Session Scratch')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'all' }));
    await user.click(screen.getByRole('button', { name: 'OFF' }));
    expect(screen.getByText('Skill Note')).toBeInTheDocument();
    expect(screen.queryByText('User Pref')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByPlaceholderText('Search memory…'), 'Pref');
    expect(screen.getByText('User Pref')).toBeInTheDocument();
    expect(screen.queryByText('Skill Note')).not.toBeInTheDocument();
  });

  it('creates memory via modal', async () => {
    listMemories
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValue({ ok: true, data: items });
    createMemory.mockResolvedValue({ ok: true, data: items[0] });
    render(<Memory />);
    await waitFor(() => expect(screen.getByText('memory.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /\+ memory\.new/i }));
    await waitFor(() => expect(screen.getByPlaceholderText('My context')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('My context'), { target: { value: 'User Pref' } });
    fireEvent.change(screen.getByPlaceholderText('Markdown content...'), {
      target: { value: 'likes dark mode' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(createMemory).toHaveBeenCalledWith({
        name: 'User Pref',
        type: 'user',
        content: 'likes dark mode',
      });
    });
  });

  it('requires name and content in modal', async () => {
    listMemories.mockResolvedValue({ ok: true, data: items });
    render(<Memory />);
    await waitFor(() => expect(screen.getByText('User Pref')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /\+ memory\.new/i }));
    await waitFor(() => expect(screen.getByPlaceholderText('My context')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(screen.getByText('Name and content are required')).toBeInTheDocument();
    expect(createMemory).not.toHaveBeenCalled();
  });

  it('rejects control-char name and null-byte content without calling API', async () => {
    listMemories.mockResolvedValue({ ok: true, data: items });
    render(<Memory />);
    await waitFor(() => expect(screen.getByText('User Pref')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /\+ memory\.new/i }));
    await waitFor(() => expect(screen.getByPlaceholderText('My context')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('My context'), {
      target: { value: `bad${'\0'}name` },
    });
    fireEvent.change(screen.getByPlaceholderText('Markdown content...'), {
      target: { value: 'ok content' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(screen.getByText('Name is invalid')).toBeInTheDocument();
    expect(createMemory).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('My context'), {
      target: { value: 'Valid Name' },
    });
    fireEvent.change(screen.getByPlaceholderText('Markdown content...'), {
      target: { value: `bad${'\0'}content` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(screen.getByText('Content is invalid')).toBeInTheDocument();
    expect(createMemory).not.toHaveBeenCalled();
  });

  it('toggles and deletes items', async () => {
    listMemories.mockResolvedValue({ ok: true, data: items });
    toggleMemory.mockResolvedValue({ ok: true });
    deleteMemory.mockResolvedValue({ ok: true });
    render(<Memory />);
    await waitFor(() => expect(screen.getByText('User Pref')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: 'memory.enabled' })[0]!);
    await waitFor(() => expect(toggleMemory).toHaveBeenCalledWith('m1'));

    fireEvent.click(screen.getAllByRole('button', { name: 'common.delete' })[0]!);
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteMemory).toHaveBeenCalledWith('m1'));
  });

  it('cancels delete when confirm is false and shows no-match filter', async () => {
    const user = userEvent.setup();
    listMemories.mockResolvedValue({ ok: true, data: items });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Memory />);
    await waitFor(() => expect(screen.getByText('User Pref')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: 'common.delete' })[0]!);
    expect(deleteMemory).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText('Search memory…'), 'zzzz-none');
    expect(screen.queryByText('User Pref')).not.toBeInTheDocument();
    expect(screen.getByText('0/4')).toBeInTheDocument();
  });

  it('Escape closes modal and clears search', async () => {
    const user = userEvent.setup();
    listMemories.mockResolvedValue({ ok: true, data: items });
    render(<Memory />);
    await waitFor(() => expect(screen.getByText('User Pref')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /\+ memory\.new/i }));
    await waitFor(() => expect(screen.getByPlaceholderText('My context')).toBeInTheDocument());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('My context')).not.toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('Search memory…'), 'x');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search memory…') as HTMLInputElement).value).toBe('');
    });
  });

  it('edits a memory item via updateMemory', async () => {
    listMemories.mockResolvedValue({ ok: true, data: items });
    updateMemory.mockResolvedValue({ ok: true });
    render(<Memory />);
    await waitFor(() => expect(screen.getByText('User Pref')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: 'common.edit' })[0]!);
    await waitFor(() => expect(screen.getByDisplayValue('User Pref')).toBeInTheDocument());
    expect(screen.getByDisplayValue('likes dark mode')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('User Pref'), { target: { value: 'User Pref v2' } });
    fireEvent.change(screen.getByDisplayValue('likes dark mode'), {
      target: { value: 'likes light mode' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(updateMemory).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({
          name: 'User Pref v2',
          content: 'likes light mode',
          type: 'user',
        }),
      );
    });
  });
});
