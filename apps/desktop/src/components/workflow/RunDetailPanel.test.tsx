import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunDetailPanel } from './RunDetailPanel.js';

const getWorkflowRun = vi.fn();

vi.mock('../../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: { getWorkflowRun },
  }),
}));

describe('RunDetailPanel', () => {
  beforeEach(() => {
    getWorkflowRun.mockReset();
  });

  it('shows loading then empty node results', async () => {
    getWorkflowRun.mockResolvedValue({
      ok: true,
      data: {
        id: 'run-12345678',
        workflowId: 'wf',
        status: 'completed',
        nodeResults: {},
        startedAt: '2020-01-01T00:00:00.000Z',
      },
    });

    render(
      <RunDetailPanel workflowId="wf" runId="run-12345678" onClose={() => {}} />,
    );
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/No node results/i)).toBeInTheDocument();
    });
  });

  it('renders node status, labels, duration, and error', async () => {
    getWorkflowRun.mockResolvedValue({
      ok: true,
      data: {
        id: 'run-abcdef01',
        workflowId: 'wf',
        status: 'failed',
        nodeResults: {
          n1: {
            nodeId: 'n1',
            status: 'completed',
            output: { ok: true },
            durationMs: 1200,
          },
          n2: {
            nodeId: 'n2',
            status: 'failed',
            error: 'boom',
          },
        },
        startedAt: '2020-01-01T00:00:00.000Z',
      },
    });

    render(
      <RunDetailPanel
        workflowId="wf"
        runId="run-abcdef01"
        nodeLabelMap={{ n1: 'Agent A', n2: 'Deploy' }}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Agent A')).toBeInTheDocument();
    });
    expect(screen.getByText('Deploy')).toBeInTheDocument();
    expect(screen.getByText('1.20s')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
  });

  it('copies node output to clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    getWorkflowRun.mockResolvedValue({
      ok: true,
      data: {
        id: 'run-copy0001',
        workflowId: 'wf',
        status: 'completed',
        nodeResults: {
          n1: { nodeId: 'n1', status: 'completed', output: 'hello-out' },
        },
        startedAt: '2020-01-01T00:00:00.000Z',
      },
    });

    render(<RunDetailPanel workflowId="wf" runId="run-copy0001" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Copy')).toBeInTheDocument());
    await user.click(screen.getByText('Copy'));
    expect(writeText).toHaveBeenCalledWith('hello-out');
    await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
  });

  it('shows error when load fails', async () => {
    getWorkflowRun.mockResolvedValue({ ok: false, error: 'nope' });
    render(<RunDetailPanel workflowId="wf" runId="run-missing" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load run details/i)).toBeInTheDocument();
    });
  });

  it('close button calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    getWorkflowRun.mockResolvedValue({
      ok: true,
      data: {
        id: 'run-x',
        workflowId: 'wf',
        status: 'completed',
        nodeResults: {},
        startedAt: '2020-01-01T00:00:00.000Z',
      },
    });
    render(<RunDetailPanel workflowId="wf" runId="run-x" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('✕')).toBeInTheDocument());
    await user.click(screen.getByText('✕'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    getWorkflowRun.mockResolvedValue({
      ok: true,
      data: {
        id: 'run-esc',
        workflowId: 'wf',
        status: 'completed',
        nodeResults: {},
        startedAt: '2020-01-01T00:00:00.000Z',
      },
    });
    render(<RunDetailPanel workflowId="wf" runId="run-esc" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('✕')).toBeInTheDocument());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
