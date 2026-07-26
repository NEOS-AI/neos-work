import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  extra?: { error?: string; nodeResults?: Record<string, unknown> },
) {
  return {
    id,
    workflowId: 'wf-1',
    status,
    nodeResults: extra?.nodeResults ?? {},
    error: extra?.error,
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
    localStorage.clear();
  });

  it('shows empty state when no runs', async () => {
    listWorkflowRuns.mockResolvedValue({ ok: true, data: [] });
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => {
      expect(screen.getByText(/No runs yet/i)).toBeInTheDocument();
    });
  });

  it('shows scrubbed load error when listWorkflowRuns fails', async () => {
    listWorkflowRuns.mockResolvedValue({
      ok: false,
      error: `runs${'\n'}down${'\0'}!`,
    });
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => {
      expect(screen.getByText('runs down!')).toBeInTheDocument();
    });
    expect(screen.queryByText(/No runs yet/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
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
    expect(localStorage.getItem('neos-run-history-status')).toBe('failed');
  });

  it('restores status filter from localStorage prefs', async () => {
    localStorage.setItem('neos-run-history-status', 'failed');
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [
        makeRun('run-completed-1', 'completed'),
        makeRun('run-failed-1', 'failed'),
      ],
    });

    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);

    await waitFor(() => {
      expect(screen.getByText('failed')).toBeInTheDocument();
    });
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
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

  it('alerts scrubbed error when clear completed fails', async () => {
    const user = userEvent.setup();
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [makeRun('run-c1', 'completed')],
    });
    clearWorkflowRuns.mockResolvedValue({
      ok: false,
      error: `busy${'\n'}now${'\0'}!`,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Clear completed/i }));
    await waitFor(() => {
      expect(clearWorkflowRuns).toHaveBeenCalledWith('wf-1', 'completed');
      expect(window.alert).toHaveBeenCalledWith('busy now!');
    });
    // Run remains after failed clear
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('alerts scrubbed message when clear completed throws', async () => {
    const user = userEvent.setup();
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [makeRun('run-c1', 'completed')],
    });
    clearWorkflowRuns.mockRejectedValue(new Error(`clear${'\n'}boom${'\0'}!`));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Clear completed/i }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('clear boom!');
    });
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('alerts scrubbed message when clear failed / cancelled throws', async () => {
    const user = userEvent.setup();
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [makeRun('run-f1', 'failed'), makeRun('run-x1', 'cancelled')],
    });
    clearWorkflowRuns
      .mockRejectedValueOnce(new Error(`fail${'\0'}path`))
      .mockRejectedValueOnce(new Error(`cancel${'\n'}path`));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Clear failed/i }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('failpath');
    });

    await user.click(screen.getByRole('button', { name: /Clear cancelled/i }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('cancel path');
    });
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('cancelled')).toBeInTheDocument();
  });

  it('alerts scrubbed error when single run delete fails and keeps the run', async () => {
    const user = userEvent.setup();
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [makeRun('run-c1', 'completed')],
    });
    deleteWorkflowRun.mockResolvedValue({
      ok: false,
      error: `locked${'\n'}run${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument());
    await user.click(screen.getByTitle(/delete|run\.delete/i));
    await waitFor(() => {
      expect(deleteWorkflowRun).toHaveBeenCalledWith('wf-1', 'run-c1');
      expect(window.alert).toHaveBeenCalledWith('locked run!');
    });
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('alerts scrubbed error when export run JSON fails', async () => {
    const user = userEvent.setup();
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [makeRun('run-c1', 'completed')],
    });
    getWorkflowRun.mockResolvedValue({
      ok: false,
      error: `export${'\n'}blocked${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument());
    await user.click(screen.getByTitle('Export run JSON'));
    await waitFor(() => {
      expect(getWorkflowRun).toHaveBeenCalledWith('wf-1', 'run-c1');
      expect(window.alert).toHaveBeenCalledWith('export blocked!');
    });
  });

  it('alerts scrubbed error when export run JSON throws', async () => {
    const user = userEvent.setup();
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [makeRun('run-c1', 'completed')],
    });
    getWorkflowRun.mockRejectedValue(new Error(`sock${'\n'}reset${'\0'}!`));
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('completed')).toBeInTheDocument());
    await user.click(screen.getByTitle('Export run JSON'));
    await waitFor(() => {
      expect(getWorkflowRun).toHaveBeenCalledWith('wf-1', 'run-c1');
      expect(window.alert).toHaveBeenCalledWith('sock reset!');
    });
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

  it('loads next page when Load more is clicked', async () => {
    const user = userEvent.setup();
    const page1 = Array.from({ length: 21 }, (_, i) =>
      makeRun(`run-a${String(i).padStart(3, '0')}`, 'completed'),
    );
    const page2 = Array.from({ length: 5 }, (_, i) =>
      makeRun(`run-b${String(i).padStart(3, '0')}`, 'failed'),
    );
    listWorkflowRuns.mockImplementation(async (_wf: string, _limit: number, offset = 0) => {
      if (offset === 0) return { ok: true, data: page1 };
      return { ok: true, data: page2 };
    });

    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /load more|common.loadMore/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /load more|common.loadMore/i }));
    await waitFor(() => {
      expect(listWorkflowRuns).toHaveBeenCalledWith('wf-1', 21, 20);
    });
    // Second page has only 5 items → no further "load more"
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /load more|common.loadMore/i })).not.toBeInTheDocument();
    });
  });

  it('scrubs control-char run errors in the list', async () => {
    listWorkflowRuns.mockResolvedValue({
      ok: true,
      data: [
        makeRun('run-err-1', 'failed', '2020-01-01T00:00:00.000Z', {
          error: `boom${'\0'}err\nnext`,
        }),
      ],
    });
    render(<RunHistoryPanel workflowId="wf-1" refreshKey={0} />);
    await waitFor(() => {
      // null-byte stripped, newline collapsed
      expect(screen.getByText(/boomerr next/)).toBeInTheDocument();
    });
  });

  it('rejects control-char workflow id without calling list API', async () => {
    listWorkflowRuns.mockClear();
    render(<RunHistoryPanel workflowId={`wf${'\n'}1`} refreshKey={0} />);
    await waitFor(() => {
      expect(
        screen.getByText('Workflow id contains invalid control characters'),
      ).toBeInTheDocument();
    });
    expect(listWorkflowRuns).not.toHaveBeenCalled();
    // Empty/error state does not mount clear buttons (no accidental clear on bad id)
    expect(screen.queryByTitle('Clear completed runs')).not.toBeInTheDocument();
  });
});
