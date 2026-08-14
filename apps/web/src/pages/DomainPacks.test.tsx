import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listDomainPacks = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({ serverUrl: 'http://127.0.0.1:3000', token: 'tok' }),
  clearConnection: vi.fn(),
}));

vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {
    status = 400;
  },
  WebApiClient: class {
    listDomainPacks = listDomainPacks;
  },
}));

const { DomainPacks } = await import('./DomainPacks.js');

describe('Web Domain Packs page', () => {
  beforeEach(() => {
    listDomainPacks.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'coding', name: 'Coding', isBuiltIn: true, workerCount: 2 }],
    });
  });

  it('lists packs', async () => {
    render(
      <MemoryRouter initialEntries={['/domain-packs']}>
        <Routes>
          <Route path="/domain-packs" element={<DomainPacks />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('pack-coding')).toBeInTheDocument());
  });
});
