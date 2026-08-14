import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listRoutines = vi.fn();
const listWorkflows = vi.fn();
const createRoutine = vi.fn();
const updateRoutine = vi.fn();
const deleteRoutine = vi.fn();
const runRoutineNow = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({ serverUrl: 'http://127.0.0.1:3000', token: 'tok' }),
  clearConnection: vi.fn(),
}));
vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {
    status = 400;
  },
  WebApiClient: class {
    listRoutines = listRoutines;
    listWorkflows = listWorkflows;
    createRoutine = createRoutine;
    updateRoutine = updateRoutine;
    deleteRoutine = deleteRoutine;
    runRoutineNow = runRoutineNow;
  },
}));

const { Routines } = await import('./Routines.js');

describe('Web Routines page', () => {
  beforeEach(() => {
    listRoutines.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'r1', name: 'Morning', workflowId: 'w1', schedule: '0 9 * * *', enabled: true }],
    });
    listWorkflows.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'w1', name: 'Demo' }],
    });
    createRoutine.mockReset().mockResolvedValue({ ok: true, data: { id: 'r2' } });
  });

  it('lists and creates a routine', async () => {
    render(
      <MemoryRouter initialEntries={['/routines']}>
        <Routes>
          <Route path="/routines" element={<Routines />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('routine-r1')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('routine-name'), { target: { value: 'Nightly' } });
    fireEvent.click(screen.getByTestId('routine-create'));
    await waitFor(() => {
      expect(createRoutine).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Nightly', workflowId: 'w1', schedule: '0 9 * * *' }),
      );
    });
  });
});
