import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const listDeployments = vi.fn();
const listWorkflows = vi.fn();
const deleteDeployment = vi.fn();
const refreshDeployment = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: { listDeployments, listWorkflows, deleteDeployment, refreshDeployment },
  }),
}));

const { Deployments } = await import('./Deployments.js');

const deployments = [
  {
    id: 'd1',
    workflowId: 'wf-1',
    provider: 'vercel' as const,
    status: 'success' as const,
    projectName: 'my-app',
    url: 'https://my-app.vercel.app',
    deploymentId: 'dep-1',
    createdAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'd2',
    workflowId: 'wf-2',
    provider: 'cloudflare' as const,
    status: 'failed' as const,
    projectName: 'pages-site',
    url: null,
    deploymentId: 'dep-2',
    statusMessage: 'build error',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const workflows = [
  {
    id: 'wf-1',
    name: 'Deploy Flow',
    domain: 'general' as const,
    nodes: [],
    edges: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'wf-2',
    name: 'Other Flow',
    domain: 'general' as const,
    nodes: [],
    edges: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <Deployments />
    </MemoryRouter>,
  );
}

describe('Deployments page', () => {
  beforeEach(() => {
    listDeployments.mockReset();
    listWorkflows.mockReset();
    deleteDeployment.mockReset();
    refreshDeployment.mockReset();
    localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows empty state', async () => {
    listDeployments.mockResolvedValue({ ok: true, data: [] });
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No deployments yet/)).toBeInTheDocument();
    });
  });

  it('lists deployments with workflow names and filters', async () => {
    const user = userEvent.setup();
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    renderPage();

    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());
    expect(screen.getByText('pages-site')).toBeInTheDocument();
    // workflow name appears in the table link and the workflow filter <option>
    expect(screen.getAllByText('Deploy Flow').length).toBeGreaterThan(0);
    expect(screen.getByText('2/2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'failed' }));
    expect(screen.getByText('pages-site')).toBeInTheDocument();
    expect(screen.queryByText('my-app')).not.toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();

    // status "all" is the first chip; provider "all" is the second
    await user.click(screen.getAllByRole('button', { name: 'all' })[0]!);
    await user.click(screen.getByRole('button', { name: 'vercel' }));
    expect(screen.getByText('my-app')).toBeInTheDocument();
    expect(screen.queryByText('pages-site')).not.toBeInTheDocument();
  });

  it('search and Escape clear', async () => {
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());

    const search = screen.getByPlaceholderText('Search project, URL, provider…');
    fireEvent.change(search, { target: { value: 'pages-site' } });
    await waitFor(() => {
      expect(screen.getByText('pages-site')).toBeInTheDocument();
      expect(screen.queryByText('my-app')).not.toBeInTheDocument();
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search project, URL, provider…') as HTMLInputElement).value).toBe('');
    });
  });

  it('refreshes a deployment row status', async () => {
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    refreshDeployment.mockResolvedValue({
      ok: true,
      data: { ...deployments[0]!, status: 'success' },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());

    const poll = screen.getAllByTitle('Poll provider for latest status')[0]!;
    fireEvent.click(poll);
    await waitFor(() => expect(refreshDeployment).toHaveBeenCalledWith('d1'));
  });

  it('deletes a deployment history entry', async () => {
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    deleteDeployment.mockResolvedValue({ ok: true });
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());

    const deleteBtns = await screen.findAllByRole('button', { name: 'Delete' });
    fireEvent.click(deleteBtns[0]!);
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteDeployment).toHaveBeenCalledWith('d1'));
  });

  it('shows load error', async () => {
    listDeployments.mockResolvedValue({ ok: false, error: 'deploy api down' });
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('deploy api down')).toBeInTheDocument();
    });
  });
});
