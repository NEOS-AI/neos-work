import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listWorkers = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({ serverUrl: 'http://127.0.0.1:3000', token: 'tok' }),
  clearConnection: vi.fn(),
}));

vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {
    status = 400;
  },
  WebApiClient: class {
    listWorkers = listWorkers;
  },
}));

const { Workers } = await import('./Workers.js');

describe('Web Workers page', () => {
  beforeEach(() => {
    listWorkers.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'general_generalist', name: 'Generalist', domain: 'general', isBuiltIn: true }],
    });
  });

  it('lists workers', async () => {
    render(
      <MemoryRouter initialEntries={['/workers']}>
        <Routes>
          <Route path="/workers" element={<Workers />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('worker-general_generalist')).toBeInTheDocument());
  });
});
