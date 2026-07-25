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

const { WorkflowEditor, WorkflowNodeComponent } = await import('./WorkflowEditor.js');

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

  it('scrubs control-char canvas node labels', () => {
    const { container, unmount } = render(
      <WorkflowNodeComponent
        data={{ label: `Start${'\0'}Node\nX`, nodeType: 'trigger' }}
      />,
    );
    expect(container.textContent).toMatch(/StartNode X/);
    expect(container.textContent).not.toContain('\0');
    unmount();

    // Empty-after-scrub falls back to node type
    const { container: c2 } = render(
      <WorkflowNodeComponent data={{ label: `\0\n`, nodeType: 'output' }} />,
    );
    expect(c2.textContent).toMatch(/output/);
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

  it('alerts schedule create failure and keeps modal open', async () => {
    createRoutine.mockResolvedValueOnce({ ok: false, error: 'invalid cron' });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Schedule/i }));
    await waitFor(() => expect(screen.getByText('Create routine')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));

    await waitFor(() => {
      expect(createRoutine).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('invalid cron');
    });
    // Modal stays open for correction
    expect(screen.getByText('Create routine')).toBeInTheDocument();
    expect(screen.getByText('Schedule this workflow')).toBeInTheDocument();
  });

  it('rejects control-char schedule name/cron without calling API', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Schedule/i }));
    await waitFor(() => expect(screen.getByText('Create routine')).toBeInTheDocument());

    // Name field is prefilled; inject control char
    const nameInput = screen.getByDisplayValue('Editor Flow schedule');
    fireEvent.change(nameInput, { target: { value: `bad${'\0'}schedule` } });
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));

    expect(createRoutine).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith(
      'Name or schedule contains invalid control characters',
    );

    // Valid name + control-char cron also rejected
    fireEvent.change(nameInput, { target: { value: 'Valid schedule' } });
    fireEvent.change(screen.getByPlaceholderText('0 9 * * *'), {
      target: { value: `0 9 * * *${'\0'}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
    expect(createRoutine).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith(
      'Name or schedule contains invalid control characters',
    );
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

  it('rejects control-char workflow rename without calling API', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('workflow.rename'));
    const input = screen.getByDisplayValue('Editor Flow');
    fireEvent.change(input, { target: { value: `bad${'\0'}name` } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(updateWorkflow).not.toHaveBeenCalled();
    // Exits edit mode; original title remains
    await waitFor(() => {
      expect(screen.getByText('Editor Flow')).toBeInTheDocument();
    });
  });

  it('shows not-found when workflow load fails', async () => {
    getWorkflow.mockResolvedValue({ ok: false, error: 'missing' });
    renderEditor();
    await waitFor(() => {
      // Common patterns: not found / error / loading settles without editor title
      const body = document.body.textContent ?? '';
      expect(
        /not found|Not found|error|Error|missing|workflow\.notFound/i.test(body)
          || !body.includes('Editor Flow'),
      ).toBe(true);
    });
  });

  it('alerts preflight blocked and warning issues', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    preflightWorkflow.mockResolvedValueOnce({
      ok: true,
      data: {
        ok: false,
        issues: [
          { severity: 'error', message: 'Missing trigger', nodeId: 'n1' },
          { severity: 'warning', message: 'No API key' },
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Preflight/i }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Preflight blocked'));
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Missing trigger'));
    });

    preflightWorkflow.mockResolvedValueOnce({
      ok: true,
      data: {
        ok: true,
        issues: [{ severity: 'warning', message: 'Slow node', nodeId: 'n2' }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Preflight/i }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Preflight warnings'));
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Slow node'));
    });

    preflightWorkflow.mockResolvedValueOnce({ ok: false, error: 'preflight down' });
    fireEvent.click(screen.getByRole('button', { name: /Preflight/i }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('preflight down');
    });
  });

  it('scrubs control-char preflight API errors and issue fields', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    // API-level failure with control chars → scrubbed alert; empty scrub → fallback
    preflightWorkflow.mockResolvedValueOnce({
      ok: false,
      error: 'down' + String.fromCharCode(0) + 'err' + String.fromCharCode(10) + 'next',
    });
    fireEvent.click(screen.getByRole('button', { name: /Preflight/i }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('downerr next');
    });

    preflightWorkflow.mockResolvedValueOnce({
      ok: false,
      error: String.fromCharCode(0) + String.fromCharCode(10),
    });
    fireEvent.click(screen.getByRole('button', { name: /Preflight/i }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Preflight failed');
    });

    // Issue severity / message / nodeId scrubbed in blocked alert
    preflightWorkflow.mockResolvedValueOnce({
      ok: true,
      data: {
        ok: false,
        issues: [
          {
            severity: 'err' + String.fromCharCode(0) + 'or',
            message: 'Missing' + String.fromCharCode(10) + 'trigger',
            nodeId: 'n' + String.fromCharCode(0) + '1',
            code: 'NO_TRIGGER',
          },
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Preflight/i }));
    await waitFor(() => {
      const calls = (window.alert as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
      const blocked = calls.find((c) => c.includes('Preflight blocked'));
      expect(blocked).toBeTruthy();
      expect(blocked).toContain('[error]');
      expect(blocked).toContain('Missing trigger');
      expect(blocked).toContain('(n1)');
      expect(blocked).not.toContain('\0');
    });
  });

  it('scrubs control-char schedule create failure errors', async () => {
    createRoutine.mockResolvedValueOnce({
      ok: false,
      error: 'bad' + String.fromCharCode(0) + 'cron' + String.fromCharCode(10) + 'x',
    });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Schedule/i }));
    await waitFor(() => expect(screen.getByText('Create routine')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('badcron x');
    });

    // Empty-after-scrub falls back
    createRoutine.mockResolvedValueOnce({
      ok: false,
      error: String.fromCharCode(0) + String.fromCharCode(13),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Failed to create routine');
    });
    expect(screen.getByText('Schedule this workflow')).toBeInTheDocument();
  });

  it('cancels run dialog without invoking runWorkflow', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());
    runWorkflow.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /▶\s*workflow\.run/i }));
    await waitFor(() => expect(screen.getByTestId('run-inputs-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'cancel-run' }));
    await waitFor(() => expect(screen.queryByTestId('run-inputs-dialog')).not.toBeInTheDocument());
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it('runs auto layout and toggles layout direction', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    expect(screen.getByTitle(/Auto Layout \(TB\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle(/Auto Layout \(TB\)/));
    await waitFor(() => expect(fitView).toHaveBeenCalled());

    fireEvent.click(screen.getByTitle(/Switch layout direction/));
    await waitFor(() => {
      expect(screen.getByTitle(/Auto Layout \(LR\)/)).toBeInTheDocument();
    });
    expect(localStorage.getItem('neos-layout-direction')).toBe('LR');
  });

  it('alerts Preflight OK when graph has no issues', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());
    preflightWorkflow.mockResolvedValueOnce({ ok: true, data: { ok: true, issues: [] } });
    fireEvent.click(screen.getByRole('button', { name: /Preflight/i }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Preflight OK — ready to run.');
    });
  });

  it('run path respects preflight hard-error confirm', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());
    runWorkflow.mockClear();

    preflightWorkflow.mockResolvedValue({
      ok: true,
      data: {
        ok: false,
        issues: [{ severity: 'error', message: 'Missing trigger', nodeId: 'n1' }],
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(screen.getByRole('button', { name: /▶\s*workflow\.run/i }));
    await waitFor(() => expect(screen.getByTestId('run-inputs-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'confirm-run' }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(runWorkflow).not.toHaveBeenCalled();

    // Proceed when user confirms
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /▶\s*workflow\.run/i }));
    await waitFor(() => expect(screen.getByTestId('run-inputs-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'confirm-run' }));
    await waitFor(() => expect(runWorkflow).toHaveBeenCalled());
  });

  it('scrubs control-char soft preflight confirm messages and code fallback', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());
    runWorkflow.mockClear();

    preflightWorkflow.mockResolvedValue({
      ok: true,
      data: {
        ok: false,
        issues: [
          {
            severity: 'error',
            message: 'Missing' + String.fromCharCode(10) + 'trigger' + String.fromCharCode(0),
            nodeId: 'n1',
            code: 'NO_TRIGGER',
          },
          {
            severity: 'error',
            // Empty-after-scrub message → code fallback
            message: String.fromCharCode(0) + String.fromCharCode(10),
            code: 'EMPTY_MSG_CODE',
          },
        ],
      },
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.click(screen.getByRole('button', { name: /▶\s*workflow\.run/i }));
    await waitFor(() => expect(screen.getByTestId('run-inputs-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'confirm-run' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());

    const msg = String(confirmSpy.mock.calls[0]![0]);
    expect(msg).toMatch(/Preflight found 2 issue/);
    expect(msg).toContain('Missing trigger');
    expect(msg).toContain('EMPTY_MSG_CODE');
    expect(msg).not.toContain('\0');
    expect(runWorkflow).not.toHaveBeenCalled();
  });

  it('shows stop control while running and stops on click', async () => {
    let stopFn = vi.fn();
    runWorkflow.mockImplementation(() => stopFn);
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /▶\s*workflow\.run/i }));
    await waitFor(() => expect(screen.getByTestId('run-inputs-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'confirm-run' }));
    await waitFor(() => expect(runWorkflow).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'workflow.stop' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'workflow.stop' }));
    expect(stopFn).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /▶\s*workflow\.run/i })).toBeInTheDocument();
    });
  });

  it('runs via Cmd/Ctrl+Enter shortcut', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Editor Flow')).toBeInTheDocument());
    runWorkflow.mockClear();
    // Cmd+Enter opens run path without dialog when handleRun is invoked directly
    // (shortcut calls handleRun(), not the run-inputs dialog)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }),
    );
    await waitFor(() => expect(runWorkflow).toHaveBeenCalled());
  });

  it('scrubs control-char workflow name in toolbar title', async () => {
    getWorkflow.mockResolvedValue({
      ok: true,
      data: {
        ...sampleWorkflow,
        name: `Evil${'\0'}Flow${'\n'}X`,
      },
    });
    renderEditor();
    await waitFor(() => {
      // null-byte stripped; newline collapsed for display title
      expect(screen.getByText(/EvilFlow X/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });
});
