import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const listDeployments = vi.fn();
const listWorkflows = vi.fn();
const deleteDeployment = vi.fn();
const refreshDeployment = vi.fn();
const checkDeployLink = vi.fn();

// Stable client identity — avoids load() re-firing every render via useCallback deps
const engineClient = {
  listDeployments,
  listWorkflows,
  deleteDeployment,
  refreshDeployment,
  checkDeployLink,
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
    checkDeployLink.mockReset();
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
    deleteDeployment.mockResolvedValue({
      ok: false as const,
      error: `for${'\n'}bidden${'\0'}!`,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    await waitFor(() => expect(deleteDeployment).toHaveBeenCalledWith('d1'));
    expect(screen.getByText('my-app')).toBeInTheDocument();
    expect(screen.getByText('pages-site')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('for bidden!')).toBeInTheDocument());
    expect(document.body.textContent).not.toContain('\0');
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

  it('scrubs control chars from load error banner', async () => {
    listDeployments.mockResolvedValue({ ok: false, error: `deploy${'\n'}api${'\0'}down` });
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => {
      // newline → space; null-byte stripped without inserting space
      expect(screen.getByText(/deploy apidown/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('surfaces scrubbed load throw and clears loading', async () => {
    listDeployments.mockRejectedValue(new Error(`load${'\n'}boom${'\0'}!`));
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/load boom!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('gates deploy URL href to http(s) and hides control-char / javascript URLs', async () => {
    const { safeDeployUrl } = await import('./Deployments.js');
    expect(safeDeployUrl('https://ok.example/path')).toBe('https://ok.example/path');
    expect(safeDeployUrl(`https://x.example/${'\0'}`)).toBe('');
    expect(safeDeployUrl('javascript:alert(1)')).toBe('');
    expect(safeDeployUrl('ftp://files.example')).toBe('');
    expect(safeDeployUrl('not a url')).toBe('');

    listDeployments.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd-js',
          workflowId: null,
          provider: 'vercel',
          status: 'success',
          projectName: 'evil',
          url: 'javascript:alert(1)',
          deploymentId: null,
          statusMessage: null,
          createdAt: '2026-02-01T00:00:00.000Z',
        },
        {
          id: 'd-ok',
          workflowId: null,
          provider: 'vercel',
          status: 'success',
          projectName: 'good',
          url: 'https://good.example/app',
          deploymentId: null,
          statusMessage: null,
          createdAt: '2026-02-02T00:00:00.000Z',
        },
      ],
    });
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText('good')).toBeInTheDocument());
    // Safe URL rendered as link without scheme prefix
    const link = screen.getByRole('link', { name: /good\.example\/app/ });
    expect(link).toHaveAttribute('href', 'https://good.example/app');
    // javascript: URL never becomes a link
    expect(screen.queryByRole('link', { name: /javascript/i })).not.toBeInTheDocument();
  });

  it('surfaces scrubbed delete throw and keeps the row', async () => {
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    deleteDeployment.mockRejectedValue(new Error(`del${'\n'}boom${'\0'}`));
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    await waitFor(() => {
      expect(deleteDeployment).toHaveBeenCalledWith('d1');
      expect(screen.getByText(/del boom/)).toBeInTheDocument();
    });
    expect(screen.getByText('my-app')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('surfaces scrubbed refresh throw', async () => {
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    refreshDeployment.mockRejectedValue(new Error(`refresh${'\n'}down${'\0'}!`));
    renderPage();
    await waitFor(() => expect(screen.getByText('my-app')).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle('Poll provider for latest status')[0]!);
    await waitFor(() => {
      expect(refreshDeployment).toHaveBeenCalledWith('d1');
      expect(screen.getByText(/refresh down!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('rejects delete/refresh when deployment id has control chars', async () => {
    listDeployments.mockResolvedValue({
      ok: true,
      data: [
        {
          id: `d${'\0'}evil`,
          workflowId: 'wf-1',
          provider: 'vercel' as const,
          projectName: 'evil-app',
          status: 'success' as const,
          url: 'https://ok.example',
          deploymentId: 'dep-evil',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderPage();
    await waitFor(() => expect(screen.getByText('evil-app')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deleteDeployment).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Deployment id contains invalid control characters');

    alertSpy.mockClear();
    fireEvent.click(screen.getByTitle('Poll provider for latest status'));
    expect(refreshDeployment).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Deployment id contains invalid control characters');
    alertSpy.mockRestore();
  });

  it('checks deployment link and shows ok / blocked / HTTP labels', async () => {
    const user = userEvent.setup();
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    checkDeployLink
      .mockResolvedValueOnce({
        ok: true,
        data: { url: 'https://my-app.vercel.app', reachable: true, blocked: false, ok: true, status: 200 },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { url: 'https://my-app.vercel.app', reachable: false, blocked: true, ok: false, reason: 'private' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { url: 'https://my-app.vercel.app', reachable: true, blocked: false, ok: false, status: 503 },
      });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('deploy-check-link-d1')).toBeInTheDocument());

    await user.click(screen.getByTestId('deploy-check-link-d1'));
    await waitFor(() => {
      expect(checkDeployLink).toHaveBeenCalledWith('https://my-app.vercel.app');
      expect(screen.getByTestId('deploy-check-link-d1')).toHaveTextContent(/ok 200/);
    });

    await user.click(screen.getByTestId('deploy-check-link-d1'));
    await waitFor(() => {
      expect(screen.getByTestId('deploy-check-link-d1')).toHaveTextContent(/blocked/);
    });

    await user.click(screen.getByTestId('deploy-check-link-d1'));
    await waitFor(() => {
      expect(screen.getByTestId('deploy-check-link-d1')).toHaveTextContent(/HTTP 503/);
    });
  });

  it('shows down reason and failed/throw labels for link check', async () => {
    const user = userEvent.setup();
    listDeployments.mockResolvedValue({ ok: true, data: deployments });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    checkDeployLink
      .mockResolvedValueOnce({
        ok: true,
        data: {
          url: 'https://my-app.vercel.app',
          reachable: false,
          blocked: false,
          ok: false,
          reason: `dns${'\n'}fail${'\0'}`,
        },
      })
      .mockResolvedValueOnce({ ok: false, error: `probe${'\n'}err` })
      .mockRejectedValueOnce(new Error(`net${'\0'}down`));

    renderPage();
    await waitFor(() => expect(screen.getByTestId('deploy-check-link-d1')).toBeInTheDocument());

    await user.click(screen.getByTestId('deploy-check-link-d1'));
    await waitFor(() => {
      expect(screen.getByTestId('deploy-check-link-d1')).toHaveTextContent(/dns fail/);
    });
    expect(document.body.textContent).not.toContain('\0');

    await user.click(screen.getByTestId('deploy-check-link-d1'));
    await waitFor(() => {
      expect(screen.getByTestId('deploy-check-link-d1')).toHaveTextContent(/probe err/);
    });

    await user.click(screen.getByTestId('deploy-check-link-d1'));
    await waitFor(() => {
      expect(screen.getByTestId('deploy-check-link-d1')).toHaveTextContent(/netdown/);
    });
  });

  it('does not check link for invalid deploy url', async () => {
    listDeployments.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd-bad',
          workflowId: 'wf-1',
          provider: 'vercel' as const,
          status: 'success' as const,
          projectName: 'bad-url',
          url: 'javascript:alert(1)',
          deploymentId: 'dep-x',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    renderPage();
    await waitFor(() => expect(screen.getByText('bad-url')).toBeInTheDocument());
    expect(screen.queryByTestId('deploy-check-link-d-bad')).not.toBeInTheDocument();
    expect(checkDeployLink).not.toHaveBeenCalled();
  });


  it('auto-polls deploying/pending deployments every 15s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listDeployments.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd-poll',
          workflowId: 'wf-1',
          provider: 'vercel' as const,
          status: 'deploying' as const,
          projectName: 'polling-app',
          url: null,
          deploymentId: 'dep-poll',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
        {
          id: `d${'\0'}skip`,
          workflowId: 'wf-1',
          provider: 'vercel' as const,
          status: 'pending' as const,
          projectName: 'skip-id',
          url: null,
          deploymentId: 'dep-skip',
          createdAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    refreshDeployment.mockResolvedValue({
      ok: true,
      data: {
        id: 'd-poll',
        workflowId: 'wf-1',
        provider: 'vercel',
        status: 'success',
        projectName: 'polling-app',
        url: 'https://polling-app.vercel.app',
        deploymentId: 'dep-poll',
        createdAt: '2026-02-01T00:00:00.000Z',
      },
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('polling-app')).toBeInTheDocument());
    refreshDeployment.mockClear();

    await vi.advanceTimersByTimeAsync(15_000);
    await waitFor(() => {
      expect(refreshDeployment).toHaveBeenCalledWith('d-poll');
      // control-char id never polled
      expect(refreshDeployment.mock.calls.every((c) => c[0] === 'd-poll')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getAllByText('success').length).toBeGreaterThanOrEqual(1);
    });
    vi.useRealTimers();
  });

});
