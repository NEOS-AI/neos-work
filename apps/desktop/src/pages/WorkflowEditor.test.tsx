import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';

const getWorkflow = vi.fn();
const listBlocks = vi.fn();
const updateWorkflow = vi.fn();
const preflightWorkflow = vi.fn();
const runWorkflow = vi.fn();
const exportWorkflow = vi.fn();
const exportWorkflowZip = vi.fn();
const createRoutine = vi.fn();
const navigate = vi.fn();
const fitView = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: {
      getWorkflow,
      listBlocks,
      updateWorkflow,
      preflightWorkflow,
      runWorkflow,
      exportWorkflow,
      exportWorkflowZip,
      createRoutine,
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ id: 'wf-1' }),
    useBlocker: () => ({ state: 'unblocked' }),
  };
});

vi.mock('@xyflow/react', () => {
  return {
    ReactFlow: ({ children, nodes }: { children?: React.ReactNode; nodes?: unknown[] }) => (
      <div data-testid="react-flow" data-node-count={Array.isArray(nodes) ? nodes.length : 0}>
        {children}
      </div>
    ),
    Background: () => <div data-testid="rf-bg" />,
    Controls: () => <div data-testid="rf-controls" />,
    MiniMap: () => <div data-testid="rf-minimap" />,
    addEdge: (connection: unknown, edges: unknown[]) => [...edges, connection],
    useNodesState: (initial: unknown[]) => {
      const [nodes, setNodes] = useState(initial);
      return [nodes, setNodes, vi.fn()];
    },
    useEdgesState: (initial: unknown[]) => {
      const [edges, setEdges] = useState(initial);
      return [edges, setEdges, vi.fn()];
    },
    useReactFlow: () => ({ fitView }),
  };
});

vi.mock('../components/workflow/NodeConfigPanel.js', () => ({
  NodeConfigPanel: () => <div data-testid="node-config-panel">config</div>,
}));
vi.mock('../components/workflow/RunHistoryPanel.js', () => ({
  RunHistoryPanel: () => <div data-testid="run-history-panel">history</div>,
}));
vi.mock('../components/workflow/RunInputsDialog.js', () => ({
  RunInputsDialog: ({
    onConfirm,
    onCancel,
  }: {
    onConfirm: (inputs?: Record<string, unknown>) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="run-inputs-dialog">
      <button type="button" onClick={() => onConfirm({})}>
        confirm-run
      </button>
      <button type="button" onClick={onCancel}>
        cancel-run
      </button>
    </div>
  ),
}));
vi.mock('../components/workflow/ConfirmLeaveModal.js', () => ({
  ConfirmLeaveModal: () => <div data-testid="confirm-leave">leave</div>,
}));
vi.mock('../components/workflow/RevisionPanel.js', () => ({
  RevisionPanel: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="revision-panel">
      <button type="button" onClick={onClose}>
        close-revisions
      </button>
    </div>
  ),
}));
vi.mock('../components/workflow/ArtifactPreview.js', () => ({
  ArtifactPreview: () => <div data-testid="artifact-preview">preview</div>,
}));
vi.mock('../components/workflow/RunLogPanel.js', () => ({
  RunLogPanel: () => <div data-testid="run-log-panel">run-log</div>,
}));
vi.mock('../components/workflow/WorkflowValidation.js', () => ({
  validateWorkflowDraft: () => [],
  summarizeValidationIssues: () => ({ total: 0, errors: 0, warnings: 0 }),
}));
vi.mock('../lib/layout.js', () => ({
  autoLayout: (nodes: unknown[]) => nodes,
}));

const { WorkflowEditor } = await import('./WorkflowEditor.js');

const sampleWorkflow = {
  id: 'wf-1',
  name: 'Editor Flow',
  description: 'desc',
  domain: 'general' as const,
  designSystemId: null,
  nodes: [
    {
      id: 'n1',
      type: 'trigger',
      label: 'Start',
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: 'n2',
      type: 'output',
      label: 'End',
      position: { x: 200, y: 0 },
      config: {},
    },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderEditor() {
  return render(
    <MemoryRouter>
      <WorkflowEditor />
    </MemoryRouter>,
  );
}

describe('WorkflowEditor page', () => {
  beforeEach(() => {
    getWorkflow.mockReset().mockResolvedValue({ ok: true, data: sampleWorkflow });
    listBlocks.mockReset().mockResolvedValue({ ok: true, data: [] });
    updateWorkflow.mockReset().mockResolvedValue({ ok: true, data: sampleWorkflow });
    preflightWorkflow.mockReset().mockResolvedValue({ ok: true, data: { ok: true, issues: [] } });
    runWorkflow.mockReset().mockReturnValue(() => {});
    exportWorkflow.mockReset();
    exportWorkflowZip.mockReset();
    createRoutine.mockReset().mockResolvedValue({ ok: true, data: { id: 'r1' } });
    navigate.mockReset();
    fitView.mockReset();
    localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('shows loading then workflow toolbar', async () => {
    renderEditor();
    expect(screen.getByText('common.loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Editor Flow')).toBeInTheDocument();
    });
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
    expect(screen.getByText('Trigger')).toBeInTheDocument();
    expect(screen.getByText('Finance Agent')).toBeInTheDocument();
    expect(screen.getByText('common.save')).toBeInTheDocument();
    expect(getWorkflow).toHaveBeenCalledWith('wf-1');
  });

  it('navigates back to workflows', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /nav\.workflows/i }));
    expect(navigate).toHaveBeenCalledWith('/workflows');
  });

  it('saves workflow via button and keyboard shortcut', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalled());

    updateWorkflow.mockClear();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalled());
  });

  it('runs preflight and opens schedule modal with Escape close', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Preflight/i }));
    await waitFor(() => {
      expect(preflightWorkflow).toHaveBeenCalledWith('wf-1');
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Preflight OK'));
    });

    fireEvent.click(screen.getByRole('button', { name: /Schedule/i }));
    await waitFor(() => expect(screen.getByText('Schedule this workflow')).toBeInTheDocument());

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByText('Schedule this workflow')).not.toBeInTheDocument();
    });
  });

  it('creates a schedule routine', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Schedule/i }));
    await waitFor(() => expect(screen.getByText('Create routine')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
    await waitFor(() => {
      expect(createRoutine).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Editor Flow schedule',
          workflowId: 'wf-1',
          schedule: '0 9 * * *',
          enabled: true,
        }),
      );
    });
  });

  it('opens shortcuts help, history panel, and run dialog', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '⌨' }));
    await waitFor(() => expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => expect(screen.queryByText('Keyboard shortcuts')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Version History'));
    await waitFor(() => expect(screen.getByTestId('revision-panel')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'close-revisions' }));
    await waitFor(() => expect(screen.queryByTestId('revision-panel')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /▶\s*workflow\.run/i }));
    await waitFor(() => expect(screen.getByTestId('run-inputs-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'confirm-run' }));
    await waitFor(() => expect(runWorkflow).toHaveBeenCalled());
  });

  it('exports JSON and ZIP and switches right panel tabs', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /workflow\.export.*JSON/i }));
    expect(exportWorkflow).toHaveBeenCalledWith('wf-1', 'Editor Flow');

    fireEvent.click(screen.getByRole('button', { name: 'Export (ZIP)' }));
    expect(exportWorkflowZip).toHaveBeenCalledWith('wf-1', 'Editor Flow');

    fireEvent.click(screen.getByRole('button', { name: 'workflow.runLog' }));
    expect(screen.getByTestId('run-log-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'workflow.history' }));
    expect(screen.getByTestId('run-history-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));
    expect(screen.getByTestId('artifact-preview')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'workflow.config' }));
    expect(screen.getByTestId('node-config-panel')).toBeInTheDocument();
  });

  it('renames workflow from title', async () => {
    updateWorkflow.mockResolvedValue({
      ok: true,
      data: { ...sampleWorkflow, name: 'Renamed Flow' },
    });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('workflow.rename'));
    const input = screen.getByDisplayValue('Editor Flow');
    fireEvent.change(input, { target: { value: 'Renamed Flow' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(updateWorkflow).toHaveBeenCalledWith(
        'wf-1',
        expect.objectContaining({ name: 'Renamed Flow' }),
      );
    });
  });
});
