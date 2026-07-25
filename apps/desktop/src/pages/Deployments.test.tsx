import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const listDeployments = vi.fn();
const listWorkflows = vi.fn();
const deleteDeployment = vi.fn();
const refreshDeployment = vi.fn();

// Stable client identity — avoids load() re-firing every render via useCallback deps
const engineClient = {
  listDeployments,
  listWorkflows,
  deleteDeployment,
  refreshDeployment,
};

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: engineClient,
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

  afterEach(() => {
    vi.useRealTimers();
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

  it('cancels delete when confirm is false and shows no-match search', async () => {
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());

    const deleteBtns = await screen.findAllByRole('button', { name: 'Delete' });
    fireEvent.click(deleteBtns[0]!);
    expect(deleteDeployment).not.toHaveBeenCalled();

    const search = screen.getByPlaceholderText('Search project, URL, provider…');
    fireEvent.change(search, { target: { value: 'zzzz-none' } });
    await waitFor(() => {
      expect(screen.queryByText('my-app')).not.toBeInTheDocument();
      expect(screen.getByText('0/2')).toBeInTheDocument();
    });
  });

  it('shows load error', async () => {
    listDeployments.mockResolvedValue({ ok: false, error: 'deploy api down' });
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('deploy api down')).toBeInTheDocument();
    });
  });

  it('handles refresh failure and reloads when workflow filter changes', async () => {
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    // Failure path: covers setError branch when poll fails (error banner may clear on re-load)
    refreshDeployment.mockImplementation(async () => ({ ok: false as const, error: 'provider timeout' }));
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle('Poll provider for latest status')[0]!);
    await waitFor(() => expect(refreshDeployment).toHaveBeenCalledWith('d1'));

    // Workflow select reloads deployments for that workflow
    listDeployments.mockClear();
    listDeployments.mockResolvedValue({ ok: true, data: [deployments[1]!] });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'wf-2' } });
    await waitFor(() => {
      expect(listDeployments).toHaveBeenCalledWith('wf-2');
    });
  });

  it('clears stale persisted workflow filter after workflows load', async () => {
    localStorage.setItem('neos-deployments-workflow', 'wf-gone');
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());
    // Stale id dropped from prefs + combobox returns to empty (all workflows)
    await waitFor(() => {
      expect(localStorage.getItem('neos-deployments-workflow') ?? '').toBe('');
    });
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
  });

  it('persists status/provider filter chips and removes row after delete', async () => {
    const user = userEvent.setup();
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    deleteDeployment.mockResolvedValue({ ok: true });
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'success' }));
    expect(localStorage.getItem('neos-deployments-status')).toBe('success');
    expect(screen.getByText('my-app')).toBeInTheDocument();
    expect(screen.queryByText('pages-site')).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'all' })[0]!);
    await user.click(screen.getByRole('button', { name: 'cloudflare' }));
    expect(localStorage.getItem('neos-deployments-provider')).toBe('cloudflare');
    expect(screen.getByText('pages-site')).toBeInTheDocument();

    // Delete remaining row
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(deleteDeployment).toHaveBeenCalledWith('d2');
      expect(screen.queryByText('pages-site')).not.toBeInTheDocument();
    });
  });

  it('refresh applies updated status and URL from provider poll', async () => {
    const active = {
      id: 'd-active',
      workflowId: 'wf-1',
      provider: 'vercel' as const,
      status: 'deploying' as const,
      projectName: 'shipping',
      url: null as string | null,
      deploymentId: 'dep-live',
      createdAt: '2026-03-01T00:00:00.000Z',
    };
    const updated = {
      ...active,
      status: 'success' as const,
      url: 'https://shipping.vercel.app',
    };
    listDeployments.mockResolvedValue({ ok: true, data: [active] });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    refreshDeployment.mockImplementation(async () => {
      listDeployments.mockResolvedValue({ ok: true, data: [updated] });
      return { ok: true as const, data: updated };
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('shipping')).toBeInTheDocument());
    expect(screen.getAllByText('deploying').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByTitle('Poll provider for latest status'));
    await waitFor(() => expect(refreshDeployment).toHaveBeenCalledWith('d-active'));
    await waitFor(() => {
      expect(screen.getByTitle('https://shipping.vercel.app')).toBeInTheDocument();
      expect(document.body.textContent).toContain('shipping.vercel.app');
    });
  });

  it('shows default load error message when API omits error field', async () => {
    listDeployments.mockResolvedValue({ ok: false });
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Failed to load deployments')).toBeInTheDocument();
    });
  });

  it('does not remove row when delete fails', async () => {
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    deleteDeployment.mockResolvedValue({ ok: false as const, error: 'forbidden' });
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    await waitFor(() => expect(deleteDeployment).toHaveBeenCalledWith('d1'));
    expect(screen.getByText('my-app')).toBeInTheDocument();
    expect(screen.getByText('pages-site')).toBeInTheDocument();
  });

  it('shows no-match empty message when status filter excludes all rows', async () => {
    const user = userEvent.setup();
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'pending' }));
    expect(screen.getByText('No deployments match the current filters.')).toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });

  it('scrubs control chars from status, message, provider, project, and workflow label', async () => {
    listDeployments.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd-scrub',
          workflowId: 'wf-1',
          provider: `vercel${'\n'}x`,
          status: `success${'\0'}`,
          projectName: `my${'\0'}app`,
          url: 'https://safe.example',
          deploymentId: 'dep-scrub',
          statusMessage: `build${'\n'}failed`,
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    listWorkflows.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'wf-1',
          name: `Deploy${'\0'}Flow`,
          domain: 'general' as const,
          nodes: [],
          edges: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    renderPage();
    await waitFor(() => {
      // null-byte stripped from project name
      expect(screen.getByText('myapp')).toBeInTheDocument();
    });
    // provider/statusMessage control collapsed for display
    expect(screen.getByText(/vercel x/)).toBeInTheDocument();
    expect(screen.getByText(/build failed/)).toBeInTheDocument();
    // workflow name scrubbed in table link and filter option
    expect(screen.getAllByText('DeployFlow').length).toBeGreaterThanOrEqual(1);
    const table = screen.getByRole('table');
    expect(table.textContent).toMatch(/success/);
    expect(table.textContent).toContain('myapp');
    expect(table.textContent).toContain('DeployFlow');
    expect(table.textContent).toMatch(/vercel x/);
    // Table + filter options scrubbed (no raw null bytes in document)
    expect(table.textContent).not.toContain('\0');
    expect(document.body.textContent).not.toContain('\0');
  });
});
