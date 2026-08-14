import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getWorkflow = vi.fn();
const updateWorkflow = vi.fn();
const runWorkflow = vi.fn();
const listWorkflowRuns = vi.fn();
const listWorkers = vi.fn();
const listBlocks = vi.fn();

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
      getWorkflow = getWorkflow;
      updateWorkflow = updateWorkflow;
      runWorkflow = runWorkflow;
      listWorkflowRuns = listWorkflowRuns;
      listWorkers = listWorkers;
      listBlocks = listBlocks;
    },
  };
});

vi.mock('@xyflow/react', () => {
  return {
    ReactFlow: ({
      children,
      nodes,
      onNodeClick,
    }: {
      children?: React.ReactNode;
      nodes?: Array<{ id: string; data?: Record<string, unknown> }>;
      onNodeClick?: (e: unknown, node: { id: string; data?: Record<string, unknown> }) => void;
    }) => (
      <div data-testid="react-flow" data-node-count={Array.isArray(nodes) ? nodes.length : 0}>
        {Array.isArray(nodes)
          && nodes.map((n) => (
            <button
              key={n.id}
              type="button"
              data-testid={`rf-node-${n.id}`}
              onClick={() => onNodeClick?.({}, n)}
            >
              {String(n.data?.label ?? n.id)}
            </button>
          ))}
        {children}
      </div>
    ),
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    Background: () => <div data-testid="rf-bg" />,
    Controls: () => <div data-testid="rf-controls" />,
    MiniMap: () => <div data-testid="rf-minimap" />,
    Handle: () => null,
    Position: { Left: 'left', Right: 'right' },
    addEdge: (connection: { source?: string; target?: string; id?: string }, edges: unknown[]) => [
      ...edges,
      { ...connection, id: connection.id ?? 'e-new' },
    ],
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = useState(initial);
      return [nodes, setNodes, vi.fn()];
    },
    useEdgesState: (initial: unknown[]) => {
      const [edges, setEdges] = useState(initial);
      return [edges, setEdges, vi.fn()];
    },
  };
});

const { WorkflowEditor } = await import('./WorkflowEditor.js');

const sampleWf = {
  id: 'w1',
  name: 'Demo',
  domain: 'general',
  description: 'desc',
  nodes: [
    {
      id: 't1',
      type: 'trigger',
      label: 'Trigger',
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: 'a1',
      type: 'agent',
      label: 'Agent',
      position: { x: 200, y: 0 },
      config: { workerId: 'general_generalist' },
    },
    {
      id: 'o1',
      type: 'output',
      label: 'Output',
      position: { x: 400, y: 0 },
      config: {},
    },
  ],
  edges: [
    { id: 'e1', source: 't1', target: 'a1' },
    { id: 'e2', source: 'a1', target: 'o1' },
  ],
};

describe('Web WorkflowEditor', () => {
  beforeEach(() => {
    getWorkflow.mockReset().mockResolvedValue({ ok: true, data: sampleWf });
    updateWorkflow.mockReset().mockResolvedValue({
      ok: true,
      data: { ...sampleWf, name: 'Demo' },
    });
    listWorkflowRuns.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'run-hist-1', status: 'completed', startedAt: '2026-01-01T00:00:00.000Z' }],
    });
    listWorkers.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'general_generalist', name: 'Generalist', domain: 'general' }],
    });
    listBlocks.mockReset().mockResolvedValue({ ok: true, data: [] });
    runWorkflow.mockReset().mockImplementation((_id, onEvent) => {
      queueMicrotask(() => {
        onEvent({ type: 'run.started', runId: 'r1' });
        onEvent({ type: 'run.completed', runId: 'r1', duration: 1 });
      });
      return () => {};
    });
    clearConnection.mockClear();
    loadConnection.mockReturnValue({
      serverUrl: 'http://127.0.0.1:3000',
      token: 'test-token',
    });
  });

  function renderEditor(id = 'w1') {
    return render(
      <MemoryRouter initialEntries={[`/workflows/${id}`]}>
        <Routes>
          <Route path="/workflows/:id" element={<WorkflowEditor />} />
          <Route path="/workflows" element={<div data-testid="wf-list">list</div>} />
          <Route path="/" element={<div data-testid="connect-page">Connect</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('redirects when no token', async () => {
    loadConnection.mockReturnValue({ serverUrl: 'http://127.0.0.1:3000', token: '' });
    renderEditor();
    await waitFor(() => {
      expect(screen.getByTestId('connect-page')).toBeInTheDocument();
    });
  });

  it('loads workflow into React Flow canvas and palette', async () => {
    renderEditor();
    await waitFor(() => {
      expect(screen.getByTestId('workflow-editor')).toBeInTheDocument();
    });
    expect(getWorkflow).toHaveBeenCalledWith('w1');
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-node-count', '3');
    expect(screen.getByTestId('palette-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('palette-agent')).toBeInTheDocument();
    expect(screen.getByTestId('palette-web_search')).toBeInTheDocument();
    expect(screen.getByTestId('palette-media')).toBeInTheDocument();
    expect(screen.getByTestId('palette-block')).toBeInTheDocument();
    expect(screen.getByTestId('palette-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-run-history')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-editor-name')).toHaveValue('Demo');
  });

  it('selects node and shows config with workerId for agent', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('rf-node-a1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rf-node-a1'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-config-form')).toBeInTheDocument();
    });
    expect(screen.getByTestId('workflow-config-type')).toHaveTextContent('agent');
    expect(screen.getByTestId('workflow-config-worker-id')).toHaveValue('general_generalist');
    expect(screen.getByTestId('workflow-config-mode')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-config-provider')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workflow-config-label'), {
      target: { value: 'My Agent' },
    });
    expect(screen.getByTestId('workflow-editor-dirty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workflow-editor-back'));
    expect(screen.getByTestId('workflow-leave-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workflow-leave-stay'));
    expect(screen.queryByTestId('workflow-leave-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('workflow-editor')).toBeInTheDocument();
  });

  it('saves via updateWorkflow with nodes/edges', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('workflow-editor-save')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('workflow-editor-save'));
    await waitFor(() => {
      expect(updateWorkflow).toHaveBeenCalled();
    });
    const [id, patch] = updateWorkflow.mock.calls[0]!;
    expect(id).toBe('w1');
    expect(patch).toMatchObject({ name: 'Demo' });
    expect(Array.isArray(patch.nodes)).toBe(true);
    expect(Array.isArray(patch.edges)).toBe(true);
    await waitFor(() => {
      expect(screen.getByTestId('workflow-editor-save-status')).toHaveTextContent(/Saved/i);
    });
  });

  it('runs workflow via runWorkflow API', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('workflow-editor-run')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('workflow-editor-run'));
    await waitFor(() => {
      expect(runWorkflow).toHaveBeenCalledWith('w1', expect.any(Function));
    });
    await waitFor(() => {
      expect(screen.getByTestId('workflow-editor-run-status')).toHaveTextContent(/Completed/i);
    });
    await waitFor(() => {
      expect(screen.getByTestId('workflow-run-run-hist-1')).toBeInTheDocument();
    });
  });

  it('filters palette by delivery tab', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('palette-tab-delivery')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('palette-tab-delivery'));
    expect(screen.getByTestId('palette-media')).toBeInTheDocument();
    expect(screen.getByTestId('palette-slack_message')).toBeInTheDocument();
    expect(screen.queryByTestId('palette-trigger')).not.toBeInTheDocument();
  });

  it('surfaces scrubbed load errors', async () => {
    getWorkflow.mockRejectedValue(new Error(`not${'\n'}found${'\0'}`));
    renderEditor();
    await waitFor(() => {
      expect(screen.getByTestId('workflow-editor-error')).toHaveTextContent(/not found/);
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('surfaces scrubbed save errors', async () => {
    updateWorkflow.mockResolvedValue({ ok: false, error: `save${'\n'}no${'\0'}` });
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('workflow-editor-save')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('workflow-editor-save'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-editor-error')).toHaveTextContent(/save no/);
    });
  });

  it('loads run history on mount and refresh', async () => {
    renderEditor();
    await waitFor(() => expect(listWorkflowRuns).toHaveBeenCalledWith('w1', 20, 0));
    await waitFor(() => expect(screen.getByTestId('workflow-run-run-hist-1')).toHaveTextContent(/completed/i));
    listWorkflowRuns.mockResolvedValueOnce({
      ok: true,
      data: [{ id: 'run-hist-2', status: 'failed', startedAt: '2026-01-02T00:00:00.000Z' }],
    });
    fireEvent.click(screen.getByTestId('workflow-runs-refresh'));
    await waitFor(() => expect(screen.getByTestId('workflow-run-run-hist-2')).toBeInTheDocument());
  });

  it('shows run history error', async () => {
    listWorkflowRuns.mockResolvedValue({ ok: false, error: `runs${'\n'}down${'\0'}` });
    renderEditor();
    await waitFor(() => {
      expect(screen.getByTestId('workflow-run-history')).toHaveTextContent(/runs down/i);
    });
    expect(screen.getByTestId('workflow-run-history').textContent).not.toContain('\0');
  });

  it('filters palette by control and finance tabs', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('palette-tabs')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('palette-tab-control'));
    expect(screen.getByTestId('palette-trigger')).toBeInTheDocument();
    expect(screen.getByTestId('palette-parallel_start')).toBeInTheDocument();
    expect(screen.queryByTestId('palette-media')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('palette-tab-finance'));
    expect(screen.getByTestId('palette-agent_finance')).toBeInTheDocument();
    expect(screen.queryByTestId('palette-trigger')).not.toBeInTheDocument();
  });

  it('shows trigger initial-inputs and output has no extra fields', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('rf-node-t1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rf-node-t1'));
    await waitFor(() => expect(screen.getByTestId('workflow-config-type')).toHaveTextContent('trigger'));
    expect(screen.getByTestId('workflow-config-initial-inputs')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('rf-node-o1'));
    await waitFor(() => expect(screen.getByTestId('workflow-config-type')).toHaveTextContent('output'));
    expect(screen.queryByTestId('workflow-config-worker-id')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workflow-config-media-type')).not.toBeInTheDocument();
  });

  it('patches agent worker, mode, and provider', async () => {
    listWorkers.mockResolvedValue({
      ok: true,
      data: [
        { id: 'general_generalist', name: 'Generalist' },
        { id: 'general_coordinator', name: 'Coordinator' },
      ],
    });
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('rf-node-a1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rf-node-a1'));
    await waitFor(() => expect(screen.getByTestId('workflow-config-worker-id')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('workflow-config-worker-id'), {
      target: { value: 'general_coordinator' },
    });
    fireEvent.change(screen.getByTestId('workflow-config-mode'), {
      target: { value: 'coordinator' },
    });
    fireEvent.change(screen.getByTestId('workflow-config-provider'), {
      target: { value: 'google' },
    });
    expect(screen.getByTestId('workflow-editor-dirty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workflow-editor-save'));
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalled());
    const patch = updateWorkflow.mock.calls[0]![1] as { nodes: Array<{ id: string; config: Record<string, unknown> }> };
    const agent = patch.nodes.find((n) => n.id === 'a1');
    expect(agent?.config).toMatchObject({
      workerId: 'general_coordinator',
      mode: 'coordinator',
      llmProvider: 'google',
    });
  });

  it('rejects control-char label edits', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('rf-node-a1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rf-node-a1'));
    await waitFor(() => expect(screen.getByTestId('workflow-config-label')).toHaveValue('Agent'));
    fireEvent.change(screen.getByTestId('workflow-config-label'), {
      target: { value: `bad${'\0'}label` },
    });
    expect(screen.queryByTestId('workflow-editor-dirty')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workflow-editor-save'));
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalled());
    const patch = updateWorkflow.mock.calls[0]![1] as { nodes: Array<{ id: string; label: string }> };
    expect(patch.nodes.find((n) => n.id === 'a1')?.label).toBe('Agent');
  });

  it('shows media / slack / search / block / deploy config fields', async () => {
    getWorkflow.mockResolvedValue({
      ok: true,
      data: {
        ...sampleWf,
        nodes: [
          {
            id: 'm1',
            type: 'media',
            label: 'Media',
            position: { x: 0, y: 0 },
            config: { mediaType: 'image', mediaProvider: 'openai', prompt: 'cat' },
          },
          {
            id: 's1',
            type: 'slack_message',
            label: 'Slack',
            position: { x: 10, y: 0 },
            config: { channel: '#ops' },
          },
          {
            id: 'q1',
            type: 'web_search',
            label: 'Search',
            position: { x: 20, y: 0 },
            config: { query: 'neos', maxResults: 5 },
          },
          {
            id: 'b1',
            type: 'block',
            label: 'Block',
            position: { x: 30, y: 0 },
            config: { blockId: 'price_lookup' },
          },
          {
            id: 'd1',
            type: 'deploy',
            label: 'Deploy',
            position: { x: 40, y: 0 },
            config: { provider: 'cloudflare' },
          },
        ],
        edges: [],
      },
    });
    listBlocks.mockResolvedValue({
      ok: true,
      data: [{ id: 'price_lookup', name: 'Price' }],
    });
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('rf-node-m1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('rf-node-m1'));
    await waitFor(() => expect(screen.getByTestId('workflow-config-media-type')).toHaveValue('image'));
    expect(screen.getByTestId('workflow-config-media-provider')).toHaveValue('openai');
    expect(screen.getByTestId('workflow-config-media-prompt')).toHaveValue('cat');
    fireEvent.change(screen.getByTestId('workflow-config-media-type'), {
      target: { value: 'audio' },
    });

    fireEvent.click(screen.getByTestId('rf-node-s1'));
    await waitFor(() => expect(screen.getByTestId('workflow-config-channel')).toHaveValue('#ops'));

    fireEvent.click(screen.getByTestId('rf-node-q1'));
    await waitFor(() => expect(screen.getByTestId('workflow-config-query')).toHaveValue('neos'));
    expect(screen.getByTestId('workflow-config-max-results')).toHaveValue(5);

    fireEvent.click(screen.getByTestId('rf-node-b1'));
    await waitFor(() => expect(screen.getByTestId('workflow-config-block-id')).toHaveValue('price_lookup'));

    fireEvent.click(screen.getByTestId('rf-node-d1'));
    await waitFor(() => expect(screen.getByTestId('workflow-config-deploy-provider')).toHaveValue('cloudflare'));
  });

  it('drops a media node from the palette onto the canvas', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument());
    const dt = {
      getData: (key: string) => {
        if (key === 'application/neos-node-type') return 'media';
        if (key === 'application/neos-node-label') return 'Media';
        if (key === 'application/neos-config') {
          return JSON.stringify({ mediaType: 'image', mediaProvider: 'openai' });
        }
        return '';
      },
      setData: vi.fn(),
      effectAllowed: 'move',
      dropEffect: 'move',
    };
    fireEvent.drop(screen.getByTestId('workflow-canvas'), {
      dataTransfer: dt,
      clientX: 120,
      clientY: 80,
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Media' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Media' }));
    await waitFor(() => expect(screen.getByTestId('workflow-config-media-type')).toHaveValue('image'));
    expect(screen.getByTestId('workflow-editor-dirty')).toBeInTheDocument();
  });

  it('ignores drop with control-char node type', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('react-flow')).toHaveAttribute('data-node-count', '3'));
    fireEvent.drop(screen.getByTestId('workflow-canvas'), {
      dataTransfer: {
        getData: (key: string) => (key === 'application/neos-node-type' ? `media${'\n'}` : ''),
        setData: vi.fn(),
        effectAllowed: 'move',
        dropEffect: 'move',
      },
      clientX: 10,
      clientY: 10,
    });
    expect(screen.getByTestId('react-flow')).toHaveAttribute('data-node-count', '3');
  });

  it('shows stop while running and cancels', async () => {
    let send: ((e: { type: string; runId?: string }) => void) | null = null;
    runWorkflow.mockImplementation((_id, onEvent) => {
      send = onEvent;
      return () => {};
    });
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('workflow-editor-run')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('workflow-editor-run'));
    await waitFor(() => expect(send).toBeTruthy());
    await act(async () => {
      send?.({ type: 'run.started', runId: 'live-1' });
    });
    await waitFor(() => expect(screen.getByTestId('workflow-editor-stop')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('workflow-editor-stop'));
    expect(screen.getByTestId('workflow-editor-run-status')).toHaveTextContent(/Cancelled/i);
    expect(screen.getByTestId('workflow-editor-run')).toBeInTheDocument();
  });

  it('scrubs run.failed errors and reloads history', async () => {
    runWorkflow.mockImplementation((_id, onEvent) => {
      queueMicrotask(() => onEvent({ type: 'run.failed', error: `boom${'\n'}x${'\0'}` }));
      return () => {};
    });
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('workflow-editor-run')).toBeInTheDocument());
    const callsBefore = listWorkflowRuns.mock.calls.length;
    fireEvent.click(screen.getByTestId('workflow-editor-run'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-editor-error')).toHaveTextContent(/boom x/);
    });
    expect(document.body.textContent).not.toContain('\0');
    await waitFor(() => expect(listWorkflowRuns.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('leave discard navigates to the workflow list', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('rf-node-a1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('rf-node-a1'));
    fireEvent.change(screen.getByTestId('workflow-config-label'), { target: { value: 'Dirty' } });
    fireEvent.click(screen.getByTestId('workflow-editor-back'));
    fireEvent.click(screen.getByTestId('workflow-leave-discard'));
    await waitFor(() => expect(screen.getByTestId('wf-list')).toBeInTheDocument());
  });

  it('shows invalid workflow id without fetching', async () => {
    render(
      <MemoryRouter initialEntries={[`/workflows/${encodeURIComponent(`bad\nid`)}`]}>
        <Routes>
          <Route path="/workflows/:id" element={<WorkflowEditor />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('workflow-editor-error')).toHaveTextContent(/Invalid workflow id/i);
    });
    expect(getWorkflow).not.toHaveBeenCalled();
  });
});
