import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listMemories = vi.fn();
const createMemory = vi.fn();
const updateMemory = vi.fn();
const deleteMemory = vi.fn();
const toggleMemory = vi.fn();

const loadConnection = vi.fn(() => ({
  serverUrl: 'http://127.0.0.1:3000',
  token: 'test-token',
}));

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => loadConnection(),
  clearConnection: vi.fn(),
}));

vi.mock('../lib/api.js', () => {
  class ApiError extends Error {
    status = 400;
  }
  return {
    ApiError,
    WebApiClient: class {
      listMemories = listMemories;
      createMemory = createMemory;
      updateMemory = updateMemory;
      deleteMemory = deleteMemory;
      toggleMemory = toggleMemory;
    },
  };
});

const { Memory } = await import('./Memory.js');

describe('Web Memory page', () => {
  beforeEach(() => {
    listMemories.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'm1', name: 'Prefs', type: 'user', enabled: true, content: 'dark mode' }],
    });
    createMemory.mockReset().mockResolvedValue({ ok: true, data: { id: 'm2' } });
    toggleMemory.mockReset().mockResolvedValue({ ok: true, data: { id: 'm1', enabled: false } });
    deleteMemory.mockReset().mockResolvedValue({ ok: true });
    loadConnection.mockReturnValue({ serverUrl: 'http://127.0.0.1:3000', token: 'test-token' });
  });

  it('lists and creates memory', async () => {
    render(
      <MemoryRouter initialEntries={['/memory']}>
        <Routes>
          <Route path="/memory" element={<Memory />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('memory-item-m1')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('memory-name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByTestId('memory-content'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('memory-save'));
    await waitFor(() => {
      expect(createMemory).toHaveBeenCalledWith({
        name: 'New',
        type: 'user',
        content: 'hello',
      });
    });
  });

  it('toggles and deletes a memory item', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteMemory.mockResolvedValue({ ok: true });
    render(
      <MemoryRouter initialEntries={['/memory']}>
        <Routes>
          <Route path="/memory" element={<Memory />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('memory-toggle-m1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('memory-toggle-m1'));
    await waitFor(() => expect(toggleMemory).toHaveBeenCalledWith('m1'));
    fireEvent.click(screen.getByTestId('memory-delete-m1'));
    await waitFor(() => expect(deleteMemory).toHaveBeenCalledWith('m1'));
  });
});
