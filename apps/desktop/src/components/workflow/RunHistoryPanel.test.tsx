import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunHistoryPanel } from './RunHistoryPanel.js';

const listWorkflowRuns = vi.fn();
const clearWorkflowRuns = vi.fn();
const deleteWorkflowRun = vi.fn();
const getWorkflowRun = vi.fn();

vi.mock('../../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: {
      listWorkflowRuns,
      clearWorkflowRuns,
      deleteWorkflowRun,
      getWorkflowRun,
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fb?: string) => fb ?? _k,
  }),
}));

function makeRun(
  id: string,
  status: 'running' | 'completed' | 'failed' | 'cancelled',
  startedAt = '2020-01-01T00:00:00.000Z',
) {
  return {
    id,
    workflowId: 'wf-1',
    status,
    nodeResults: {},
    startedAt,
    completedAt: status === 'running' ? undefined : '2020-01-01T00:01:00.000Z',
  };
}

describe('RunHistoryPanel', () => {
  beforeEach(() => {
    listWorkflowRuns.mockReset();
    clearWorkflowRuns.mockReset();
    deleteWorkflowRun.mockReset();
    getWorkflowRun.mockReset();
  });

  it('shows empty state when no runs', async () => {
    listWorkflowRuns.mockResolvedValue({ ok: true, data: [] });
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => {
      expect(screen.getByText(/No runs yet/i)).toBeInTheDocument();
    });
  });

  it('lists runs and filters by status chips', async () => {
    const user = userEvent.setup();
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [
        makeRun('run-completed-1', 'completed'),
        makeRun('run-failed-1', 'failed'),
        makeRun('run-running-1', 'running'),
      ],
    });

    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByText('completed')).toBeInTheDocument();
    });
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText(/3\/3/)).toBeInTheDocument();

    // filter chip is exact "Failed", not "Clear failed"
    await user.click(screen.getByRole('button', { name: 'Failed' }));
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
    expect(screen.getByText(/1\/3/)).toBeInTheDocument();
  });

  it('shows empty filter message when chip matches nothing', async () => {
    const user = userEvent.setup();
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [makeRun('run-only-completed', 'completed')],
    });
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Cancelled' }));
    expect(screen.getByText(/No runs match the current filter/i)).toBeInTheDocument();
  });

  it('clear completed confirms and calls API', async () => {
    const user = userEvent.setup();
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [makeRun('run-c1', 'completed'), makeRun('run-f1', 'failed')],
    });
    clearWorkflowRuns.mockResolvedValue({ ok: true, data: { deleted: 1 } });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Clear completed/i }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(clearWorkflowRuns).toHaveBeenCalledWith('wf-1', 'completed');
    confirmSpy.mockRestore();
  });

  it('does not clear when confirm cancelled', async () => {
    const user = userEvent.setup();
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [makeRun('run-c1', 'completed')],
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Clear completed/i }));
    expect(clearWorkflowRuns).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('shows Load more when more than one page of runs', async () => {
    const page = Array.from({ length: 21 }, (_, i) =>
      makeRun(`run-${String(i).padStart(4, '0')}`, 'completed'),
    );
    listWorkflowRuns.mockResolvedValue({ ok: true, data: page });
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /load more|common.loadMore/i })).toBeInTheDocument();
    });
    // first page request uses PAGE_SIZE + 1
    expect(listWorkflowRuns).toHaveBeenCalledWith('wf-1', 21, 0);
  });
});
