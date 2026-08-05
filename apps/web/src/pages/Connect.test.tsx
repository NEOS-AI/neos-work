import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const saveConnection = vi.fn();
const navigate = vi.fn();
const health = vi.fn();
const listProjects = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({
    serverUrl: 'http://127.0.0.1:3000',
    token: '',
  }),
  saveConnection: (...args: unknown[]) => saveConnection(...args),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock('../lib/api.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/api.js')>('../lib/api.js');
  return {
    ...actual,
    WebApiClient: class {
      constructor(
        public serverUrl: string,
        public token: string,
      ) {}
      health = health;
      listProjects = listProjects;
    },
  };
});

const { Connect } = await import('./Connect.js');
const { ApiError } = await import('../lib/api.js');

describe('Connect', () => {
  beforeEach(() => {
    saveConnection.mockClear();
    navigate.mockClear();
    health.mockReset().mockResolvedValue({ status: 'ok', version: '1.0', uptime: 1 });
    listProjects.mockReset().mockResolvedValue({ ok: true, data: [] });
  });

  it('maps 401 on listProjects to invalid token message and does not save', async () => {
    listProjects.mockRejectedValue(new ApiError('Unauthorized', 401));
    render(
      <MemoryRouter>
        <Connect />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('connect-token'), {
      target: { value: 'bad-token-value' },
    });
    fireEvent.click(screen.getByTestId('connect-submit'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Invalid auth token \(401\)/i);
    });
    expect(saveConnection).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('saves and navigates on success', async () => {
    render(
      <MemoryRouter>
        <Connect />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('connect-token'), {
      target: { value: 'good-token-16chars' },
    });
    fireEvent.click(screen.getByTestId('connect-submit'));
    await waitFor(() => {
      expect(saveConnection).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith('/projects');
    });
  });
});
