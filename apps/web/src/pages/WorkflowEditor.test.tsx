import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getWorkflow = vi.fn();
const updateWorkflow = vi.fn();
const runWorkflow = vi.fn();

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
    fireEvent.change(screen.getByTestId('workflow-config-label'), {
      target: { value: 'My Agent' },
    });
    expect(screen.getByTestId('workflow-editor-dirty')).toBeInTheDocument();
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
});
