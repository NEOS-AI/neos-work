import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listDesignSystems = vi.fn();
const createDesignSystem = vi.fn();
const deleteDesignSystem = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({ serverUrl: 'http://127.0.0.1:3000', token: 'tok' }),
  clearConnection: vi.fn(),
}));
vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {
    status = 400;
  },
  WebApiClient: class {
    listDesignSystems = listDesignSystems;
    createDesignSystem = createDesignSystem;
    deleteDesignSystem = deleteDesignSystem;
  },
}));

const { DesignSystems } = await import('./DesignSystems.js');

describe('Web Design Systems page', () => {
  beforeEach(() => {
    listDesignSystems.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'neos-default', name: 'NEOS Default', source: 'bundled' }],
    });
    createDesignSystem.mockReset().mockResolvedValue({ ok: true, data: { id: 'ds-new', name: 'Mine' } });
  });

  it('lists and creates a design system', async () => {
    render(
      <MemoryRouter initialEntries={['/design-systems']}>
        <Routes>
          <Route path="/design-systems" element={<DesignSystems />} />
          <Route path="/design-systems/:id" element={<div data-testid="ds-ed">ed</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('ds-open-neos-default')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('ds-name'), { target: { value: 'Mine' } });
    fireEvent.click(screen.getByTestId('ds-create'));
    await waitFor(() => expect(createDesignSystem).toHaveBeenCalledWith('Mine', ''));
    await waitFor(() => expect(screen.getByTestId('ds-ed')).toBeInTheDocument());
  });
});
