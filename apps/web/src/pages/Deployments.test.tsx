import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listDeployments = vi.fn();
const createDeployment = vi.fn();
const refreshDeployment = vi.fn();
const deleteDeployment = vi.fn();
const deployPreflight = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({ serverUrl: 'http://127.0.0.1:3000', token: 'tok' }),
  clearConnection: vi.fn(),
}));
vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {
    status = 400;
  },
  WebApiClient: class {
    listDeployments = listDeployments;
    createDeployment = createDeployment;
    refreshDeployment = refreshDeployment;
    deleteDeployment = deleteDeployment;
    deployPreflight = deployPreflight;
  },
}));

const { Deployments } = await import('./Deployments.js');

describe('Web Deployments page', () => {
  beforeEach(() => {
    listDeployments.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'd1', provider: 'vercel', projectName: 'site', status: 'success' }],
    });
    createDeployment.mockReset().mockResolvedValue({ ok: true, data: { id: 'd2' } });
    deployPreflight.mockReset().mockResolvedValue({
      ok: true,
      data: { ready: true, checks: [{ key: 'token', ok: true, message: 'ok' }] },
    });
  });

  it('lists deployments and runs preflight', async () => {
    render(
      <MemoryRouter initialEntries={['/deployments']}>
        <Routes>
          <Route path="/deployments" element={<Deployments />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('deploy-d1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('deploy-preflight'));
    await waitFor(() => expect(deployPreflight).toHaveBeenCalledWith('vercel', 'neos-deploy'));
    await waitFor(() => expect(screen.getByTestId('deploy-preflight-result')).toBeInTheDocument());
  });

  it('creates a deployment from the form', async () => {
    render(
      <MemoryRouter initialEntries={['/deployments']}>
        <Routes>
          <Route path="/deployments" element={<Deployments />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('deploy-create')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('deploy-project-name'), { target: { value: 'landing' } });
    fireEvent.click(screen.getByTestId('deploy-create'));
    await waitFor(() => {
      expect(createDeployment).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'vercel', projectName: 'landing' }),
      );
    });
  });
});
