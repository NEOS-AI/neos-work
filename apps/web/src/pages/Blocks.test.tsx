import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listBlocks = vi.fn();
const createBlock = vi.fn();
const deleteBlock = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({ serverUrl: 'http://127.0.0.1:3000', token: 'tok' }),
  clearConnection: vi.fn(),
}));
vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {
    status = 400;
  },
  WebApiClient: class {
    listBlocks = listBlocks;
    createBlock = createBlock;
    deleteBlock = deleteBlock;
  },
}));

const { Blocks } = await import('./Blocks.js');

describe('Web Blocks page', () => {
  beforeEach(() => {
    listBlocks.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'price_lookup', name: 'Price', domain: 'finance', isBuiltIn: true }],
    });
    createBlock.mockReset().mockResolvedValue({ ok: true, data: { id: 'my_block' } });
  });

  it('lists and creates a prompt block', async () => {
    render(
      <MemoryRouter initialEntries={['/blocks']}>
        <Routes>
          <Route path="/blocks" element={<Blocks />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('block-price_lookup')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('block-id'), { target: { value: 'my_block' } });
    fireEvent.change(screen.getByTestId('block-name'), { target: { value: 'Mine' } });
    fireEvent.change(screen.getByTestId('block-prompt'), { target: { value: 'Do X' } });
    fireEvent.click(screen.getByTestId('block-create'));
    await waitFor(() => {
      expect(createBlock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'my_block', name: 'Mine', implementationType: 'prompt' }),
      );
    });
  });

  it('deletes a custom block after confirm', async () => {
    listBlocks.mockResolvedValue({
      ok: true,
      data: [{ id: 'custom_1', name: 'Custom', domain: 'general', isBuiltIn: false }],
    });
    deleteBlock.mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MemoryRouter initialEntries={['/blocks']}>
        <Routes>
          <Route path="/blocks" element={<Blocks />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('block-delete-custom_1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('block-delete-custom_1'));
    await waitFor(() => expect(deleteBlock).toHaveBeenCalledWith('custom_1'));
  });
});
