import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listWorkflows = vi.fn();
const createWorkflow = vi.fn();
const deleteWorkflow = vi.fn();

const loadConnection = vi.fn(() => ({
  serverUrl: 'http://127.0.0.1:3000',
  token: 'test-token',
}));
const clearConnection = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => loadConnection(),
  clearConnection: (...args: unknown[]) => clearConnection(...args),
}));

vi.mock('../lib/api.js', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    WebApiClient: class {
      listWorkflows = listWorkflows;
      createWorkflow = createWorkflow;
      deleteWorkflow = deleteWorkflow;
    },
  };
});

const { Workflows } = await import('./Workflows.js');

const sample = [
  {
    id: 'w1',
    name: 'Pipeline',
    domain: 'coding',
    primaryDomain: 'coding',
    updatedAt: '2026-06-01T12:00:00.000Z',
  },
  {
    id: 'w2',
    name: 'Research',
    domain: 'research',
    updatedAt: '2026-05-01T00:00:00.000Z',
  },
];

describe('Web Workflows page', () => {
  beforeEach(() => {
    listWorkflows.mockReset().mockResolvedValue({ ok: true, data: sample });
    createWorkflow.mockReset().mockResolvedValue({
      ok: true,
      data: { id: 'w-new', name: 'Landing', domain: 'general' },
    });
    deleteWorkflow.mockReset().mockResolvedValue({ ok: true });
    clearConnection.mockClear();
    loadConnection.mockReturnValue({
      serverUrl: 'http://127.0.0.1:3000',
      token: 'test-token',
    });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });

  function renderWorkflows(initial = '/workflows') {
    return render(
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/workflows/:id" element={<div data-testid="wf-editor">editor</div>} />
          <Route path="/" element={<div data-testid="connect-page">Connect</div>} />
          <Route path="/projects" element={<div>Projects</div>} />
          <Route path="/media" element={<div>Media</div>} />
          <Route path="/settings" element={<div>Settings</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('redirects to connect when no token', async () => {
    loadConnection.mockReturnValue({ serverUrl: 'http://127.0.0.1:3000', token: '' });
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getByTestId('connect-page')).toBeInTheDocument();
    });
  });

  it('lists workflows with domain and nav links', async () => {
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getByText('Pipeline')).toBeInTheDocument();
      expect(screen.getByText('Research')).toBeInTheDocument();
    });
    expect(screen.getByTestId('wf-nav-projects')).toBeInTheDocument();
    expect(screen.getByTestId('wf-nav-media')).toBeInTheDocument();
    expect(screen.getByTestId('wf-nav-settings')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-open-w1')).toBeInTheDocument();
  });

  it('shows empty state', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getByTestId('workflow-list-empty')).toBeInTheDocument();
    });
  });

  it('creates workflow via modal and navigates to editor', async () => {
    renderWorkflows();
    await waitFor(() => expect(screen.getByTestId('workflow-create-open')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('workflow-create-open'));
    expect(screen.getByTestId('workflow-create-modal')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('workflow-create-name'), {
      target: { value: 'Landing' },
    });
    fireEvent.change(screen.getByTestId('workflow-create-domain'), {
      target: { value: 'coding' },
    });
    fireEvent.click(screen.getByTestId('workflow-create-submit'));

    await waitFor(() => {
      expect(createWorkflow).toHaveBeenCalled();
    });
    const arg = createWorkflow.mock.calls[0]![0] as {
      name: string;
      primaryDomain: string;
      nodes: unknown[];
    };
    expect(arg.name).toBe('Landing');
    expect(arg.primaryDomain).toBe('coding');
    expect(Array.isArray(arg.nodes)).toBe(true);
    expect(arg.nodes.length).toBe(2);

    await waitFor(() => {
      expect(screen.getByTestId('wf-editor')).toBeInTheDocument();
    });
  });

  it('surfaces scrubbed create errors', async () => {
    createWorkflow.mockResolvedValue({ ok: false, error: `quota${'\n'}full${'\0'}` });
    renderWorkflows();
    await waitFor(() => expect(screen.getByTestId('workflow-create-open')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('workflow-create-open'));
    fireEvent.change(screen.getByTestId('workflow-create-name'), {
      target: { value: 'Nope' },
    });
    fireEvent.click(screen.getByTestId('workflow-create-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-create-error')).toHaveTextContent(/quota full/);
    });
    expect(document.body.textContent).not.toContain('\0');
    expect(screen.queryByTestId('wf-editor')).not.toBeInTheDocument();
  });

  it('deletes with confirm', async () => {
    renderWorkflows();
    await waitFor(() => expect(screen.getByTestId('workflow-delete-w1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('workflow-delete-w1'));
    await waitFor(() => {
      expect(deleteWorkflow).toHaveBeenCalledWith('w1');
    });
    await waitFor(() => {
      expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
    });
  });

  it('skips delete when confirm is false', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    renderWorkflows();
    await waitFor(() => expect(screen.getByTestId('workflow-delete-w1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('workflow-delete-w1'));
    expect(deleteWorkflow).not.toHaveBeenCalled();
  });

  it('surfaces list load errors scrubbed', async () => {
    listWorkflows.mockRejectedValue(new Error(`load${'\n'}fail${'\0'}`));
    renderWorkflows();
    await waitFor(() => {
      expect(screen.getByTestId('workflow-list-error')).toHaveTextContent(/load fail/);
    });
    expect(document.body.textContent).not.toContain('\0');
  });
});
