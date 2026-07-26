import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listRoutines = vi.fn();
const listWorkflows = vi.fn();
const createRoutine = vi.fn();
const updateRoutine = vi.fn();
const deleteRoutine = vi.fn();
const runRoutineNow = vi.fn();
const listRoutineRuns = vi.fn();
const crystallizeRoutineRun = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: {
      listRoutines,
      listWorkflows,
      createRoutine,
      updateRoutine,
      deleteRoutine,
      runRoutineNow,
      listRoutineRuns,
      crystallizeRoutineRun,
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { Routines } = await import('./Routines.js');

const workflows = [
  {
    id: 'wf-1',
    name: 'Daily Digest Flow',
    domain: 'general' as const,
    nodes: [],
    edges: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const routines = [
  {
    id: 'r1',
    name: 'Morning Digest',
    workflowId: 'wf-1',
    schedule: '0 9 * * *',
    timezone: 'UTC',
    enabled: true,
    inputs: {},
    lastRunAt: '2026-02-01T09:00:00.000Z',
    nextRunAt: '2026-02-02T09:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'r2',
    name: 'Hourly Sync',
    workflowId: 'wf-1',
    schedule: '0 * * * *',
    timezone: 'Asia/Seoul',
    enabled: false,
    inputs: {},
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-20T00:00:00.000Z',
  },
];

const runs = [
  {
    id: 'run-1',
    routineId: 'r1',
    runId: 'wr-1',
    status: 'completed',
    startedAt: '2026-02-01T09:00:00.000Z',
    completedAt: '2026-02-01T09:01:00.000Z',
  },
  {
    id: 'run-2',
    routineId: 'r1',
    status: 'failed',
    startedAt: '2026-01-31T09:00:00.000Z',
    error: 'timeout',
  },
];

describe('Routines page', () => {
  beforeEach(() => {
    listRoutines.mockReset();
    listWorkflows.mockReset();
    createRoutine.mockReset();
    updateRoutine.mockReset();
    deleteRoutine.mockReset();
    runRoutineNow.mockReset();
    listRoutineRuns.mockReset();
    crystallizeRoutineRun.mockReset();
    localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('shows scrubbed load error when listRoutines fails', async () => {
    listRoutines.mockResolvedValue({
      ok: false,
      error: `rtn${'\n'}down${'\0'}!`,
    });
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    render(<Routines />);
    await waitFor(() => {
      expect(screen.getByText('rtn down!')).toBeInTheDocument();
    });
    expect(screen.queryByText(/No routines\. Create one/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('shows empty state', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: [] });
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    render(<Routines />);
    await waitFor(() => {
      expect(screen.getByText(/No routines\. Create one to automate workflows\./)).toBeInTheDocument();
    });
    expect(screen.getByText('Select a routine to manage it')).toBeInTheDocument();
  });

  it('lists routines and filters by enabled/search', async () => {
    const user = userEvent.setup();
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    render(<Routines />);

    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    expect(screen.getByText('Hourly Sync')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getAllByText('Daily Digest Flow').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'ON' }));
    expect(screen.getByText('Morning Digest')).toBeInTheDocument();
    expect(screen.queryByText('Hourly Sync')).not.toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getByRole('button', { name: 'OFF' }));
    expect(screen.getByText('Hourly Sync')).toBeInTheDocument();
    expect(screen.queryByText('Morning Digest')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByPlaceholderText('Search routines…'), 'Hourly');
    expect(screen.getByText('Hourly Sync')).toBeInTheDocument();
    expect(screen.queryByText('Morning Digest')).not.toBeInTheDocument();
  });

  it('Escape clears search and closes create modal', async () => {
    const user = userEvent.setup();
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search routines…'), 'Morning');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search routines…') as HTMLInputElement).value).toBe('');
    });

    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    await waitFor(() => expect(screen.getByText('New Routine')).toBeInTheDocument());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByText('New Routine')).not.toBeInTheDocument();
    });
  });

  it('validates create form and creates a routine', async () => {
    const user = userEvent.setup();
    listRoutines
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    createRoutine.mockResolvedValue({ ok: true, data: routines[0] });
    render(<Routines />);
    await waitFor(() => expect(screen.getByText(/No routines/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    await waitFor(() => expect(screen.getByText('New Routine')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(createRoutine).not.toHaveBeenCalled();

    // Control-char name rejected client-side (null byte survives controlled input events)
    fireEvent.change(screen.getByPlaceholderText('Daily digest'), {
      target: { value: `bad${'\0'}name` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Name is invalid')).toBeInTheDocument();
    expect(createRoutine).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Daily digest'), {
      target: { value: 'Morning Digest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Select a workflow')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('— Select workflow —'), { target: { value: 'wf-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createRoutine).toHaveBeenCalledWith({
        name: 'Morning Digest',
        workflowId: 'wf-1',
        schedule: '0 9 * * *',
        timezone: 'UTC',
        enabled: true,
      });
    });
  });

  it('shows create API error and keeps modal open', async () => {
    const user = userEvent.setup();
    listRoutines.mockResolvedValue({ ok: true, data: [] });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    createRoutine.mockResolvedValue({ ok: false, error: 'invalid cron' });
    render(<Routines />);
    await waitFor(() => expect(screen.getByText(/No routines/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    await waitFor(() => expect(screen.getByText('New Routine')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Daily digest'), 'Broken');
    fireEvent.change(screen.getByDisplayValue('— Select workflow —'), { target: { value: 'wf-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createRoutine).toHaveBeenCalled();
      expect(screen.getByText('invalid cron')).toBeInTheDocument();
    });
    // Modal stays open for correction
    expect(screen.getByText('New Routine')).toBeInTheDocument();
  });

  it('scrubs control-char create API error banner', async () => {
    const user = userEvent.setup();
    listRoutines.mockResolvedValue({ ok: true, data: [] });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    createRoutine.mockResolvedValue({
      ok: false,
      error: `invalid${'\n'}cron${'\0'}!`,
    });
    render(<Routines />);
    await waitFor(() => expect(screen.getByText(/No routines/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    await waitFor(() => expect(screen.getByText('New Routine')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Daily digest'), 'Broken');
    fireEvent.change(screen.getByDisplayValue('— Select workflow —'), { target: { value: 'wf-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createRoutine).toHaveBeenCalled();
      expect(screen.getByText('invalid cron!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('selects routine, loads runs, toggles, runs now, deletes', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({ ok: true, data: runs });
    updateRoutine.mockResolvedValue({ ok: true, data: { ...routines[0], enabled: false } });
    runRoutineNow.mockResolvedValue({ ok: true, data: { runId: 'new-run-12345678' } });
    deleteRoutine.mockResolvedValue({ ok: true });
    render(<Routines />);

    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning Digest'));

    await waitFor(() => expect(listRoutineRuns).toHaveBeenCalledWith('r1'));
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crystallize' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(updateRoutine).toHaveBeenCalledWith('r1', { enabled: false }));

    fireEvent.click(screen.getByRole('button', { name: '▶ Run Now' }));
    await waitFor(() => {
      expect(runRoutineNow).toHaveBeenCalledWith('r1');
      expect(window.alert).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteRoutine).toHaveBeenCalledWith('r1'));
  });

  it('shows scrubbed error when listRoutineRuns fails', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({
      ok: false,
      error: `runs${'\n'}down${'\0'}!`,
    });
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning Digest'));
    await waitFor(() => {
      expect(listRoutineRuns).toHaveBeenCalledWith('r1');
      expect(screen.getByText('runs down!')).toBeInTheDocument();
    });
    expect(screen.queryByText('No runs yet')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('alerts scrubbed error when routine delete fails', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({ ok: true, data: runs });
    deleteRoutine.mockResolvedValue({
      ok: false,
      error: `still${'\n'}running${'\0'}!`,
    });
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning Digest'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(deleteRoutine).toHaveBeenCalledWith('r1');
      expect(window.alert).toHaveBeenCalledWith('still running!');
    });
    // List + detail still show the routine after failed delete
    expect(screen.getAllByText('Morning Digest').length).toBeGreaterThanOrEqual(1);
    expect((window.alert as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).not.toContain('\0');
  });

  it('alerts scrubbed error when routine toggle fails', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({ ok: true, data: runs });
    updateRoutine.mockResolvedValue({
      ok: false,
      error: `toggle${'\n'}denied${'\0'}!`,
    });
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning Digest'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => {
      expect(updateRoutine).toHaveBeenCalledWith('r1', { enabled: false });
      expect(window.alert).toHaveBeenCalledWith('toggle denied!');
    });
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('saves schedule edits and crystallizes completed runs', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({ ok: true, data: runs });
    updateRoutine.mockResolvedValue({ ok: true, data: routines[0] });
    crystallizeRoutineRun.mockResolvedValue({
      ok: true,
      data: { name: 'skill-from-run', path: '/skills/skill-from-run' },
    });
    render(<Routines />);

    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning Digest'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save schedule' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Every hour' }));
    fireEvent.click(screen.getByRole('button', { name: 'Asia/Seoul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

    await waitFor(() => {
      expect(updateRoutine).toHaveBeenCalledWith('r1', {
        schedule: '0 * * * *',
        timezone: 'Asia/Seoul',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Crystallize' }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(crystallizeRoutineRun).toHaveBeenCalledWith('r1', 'run-1');
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('skill-from-run'));
    });
  });

  it('rejects control-char schedule/timezone on create and schedule edit', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({ ok: true, data: runs });
    render(<Routines />);

    // Create form: control-char schedule
    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    await waitFor(() => expect(screen.getByText('New Routine')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Daily digest'), {
      target: { value: 'Valid Name' },
    });
    fireEvent.change(screen.getByDisplayValue('— Select workflow —'), { target: { value: 'wf-1' } });
    fireEvent.change(screen.getByPlaceholderText('0 9 * * *'), {
      target: { value: `0 9 * * *${'\0'}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Schedule is invalid')).toBeInTheDocument();
    expect(createRoutine).not.toHaveBeenCalled();

    // Create form: control-char timezone
    fireEvent.change(screen.getByPlaceholderText('0 9 * * *'), {
      target: { value: '0 9 * * *' },
    });
    fireEvent.change(screen.getByPlaceholderText('Asia/Seoul'), {
      target: { value: `UTC${'\0'}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Timezone is invalid')).toBeInTheDocument();
    expect(createRoutine).not.toHaveBeenCalled();

    // Close modal and edit existing schedule
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('New Routine')).not.toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning Digest'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save schedule' })).toBeInTheDocument());

    const scheduleInputs = screen.getAllByPlaceholderText('0 9 * * *');
    fireEvent.change(scheduleInputs[0]!, { target: { value: `0 * * * *${'\0'}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(screen.getByText('Schedule is invalid')).toBeInTheDocument();
    expect(updateRoutine).not.toHaveBeenCalled();
  });

  it('shows no-match filter empty state', async () => {
    const user = userEvent.setup();
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search routines…'), 'zzzz-nope');
    expect(screen.getByText('No routines match filters.')).toBeInTheDocument();
  });

  it('scrubs control chars from list name, schedule, timezone, and workflow label', async () => {
    listRoutines.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'r-scrub',
          name: `Rtn${'\0'}X`,
          workflowId: 'wf-1',
          schedule: `0 9 * * *${'\n'}extra`,
          timezone: `UTC${'\n'}x`,
          enabled: true,
          inputs: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    listWorkflows.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'wf-1',
          name: `Daily${'\0'}Digest`,
          domain: 'general' as const,
          nodes: [],
          edges: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    listRoutineRuns.mockResolvedValue({ ok: true, data: [] });
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('RtnX')).toBeInTheDocument());
    expect(screen.getByText(/0 9 \* \* \* extra/)).toBeInTheDocument();
    expect(screen.getByText(/UTC x/)).toBeInTheDocument();
    expect(screen.getByText('DailyDigest')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');

    // Detail panel also scrubs (was raw before v0.3.146)
    fireEvent.click(screen.getByText('RtnX'));
    await waitFor(() => expect(screen.getByRole('button', { name: '▶ Run Now' })).toBeInTheDocument());
    // Name appears in list + detail heading
    expect(screen.getAllByText('RtnX').length).toBeGreaterThanOrEqual(2);
    // Schedule/timezone line in detail (parenthesized timezone)
    expect(screen.getByText(/0 9 \* \* \* extra \(UTC x\)/)).toBeInTheDocument();
    // Workflow field in detail
    expect(screen.getAllByText('DailyDigest').length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain('\0');
  });

  it('scrubs control-char schedule update API error', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({ ok: true, data: runs });
    updateRoutine.mockResolvedValue({
      ok: false,
      error: `bad${'\n'}cron${'\0'}!`,
    });
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning Digest'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save schedule' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => {
      expect(updateRoutine).toHaveBeenCalled();
      expect(screen.getByText('bad cron!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('run-now failure alerts scrubbed error; crystallize failure alerts', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({ ok: true, data: runs });
    runRoutineNow.mockResolvedValue({
      ok: false,
      error: `scheduler${'\n'}busy${'\0'}!`,
    });
    crystallizeRoutineRun.mockResolvedValue({ ok: false, error: 'disk full' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning Digest'));
    await waitFor(() => expect(screen.getByRole('button', { name: '▶ Run Now' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '▶ Run Now' }));
    await waitFor(() => {
      expect(runRoutineNow).toHaveBeenCalledWith('r1');
      expect(window.alert).toHaveBeenCalledWith('scheduler busy!');
    });
    expect(window.alert).not.toHaveBeenCalledWith(expect.stringContaining('Triggered'));
    expect((window.alert as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).not.toContain('\0');

    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Crystallize' }));
    await waitFor(() => {
      expect(crystallizeRoutineRun).toHaveBeenCalledWith('r1', 'run-1');
      expect(window.alert).toHaveBeenCalledWith('disk full');
    });
  });

  it('scrubs control-char runId / crystallize name+path / error alerts', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({ ok: true, data: runs });
    runRoutineNow.mockResolvedValue({
      ok: true,
      // null stripped, LF collapsed → "abcd efghijkl", then slice(0, 8) → "abcd efg"
      data: { runId: 'ab' + String.fromCharCode(0) + 'cd' + String.fromCharCode(10) + 'efghijkl' },
    });
    crystallizeRoutineRun
      .mockResolvedValueOnce({
        ok: true,
        data: {
          name: 'sk' + String.fromCharCode(0) + 'ill' + String.fromCharCode(10) + 'x',
          path: '/p' + String.fromCharCode(0) + 'ath',
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: 'disk' + String.fromCharCode(0) + 'full' + String.fromCharCode(10) + 'now',
      })
      .mockResolvedValueOnce({
        ok: false,
        error: String.fromCharCode(0) + String.fromCharCode(10),
      });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertMock = window.alert as ReturnType<typeof vi.fn>;
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning Digest'));
    await waitFor(() => expect(screen.getByRole('button', { name: '▶ Run Now' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '▶ Run Now' }));
    await waitFor(() => expect(runRoutineNow).toHaveBeenCalledWith('r1'));
    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('Triggered! runId: abcd efg');
    });
    expect(String(alertMock.mock.calls.at(-1)?.[0] ?? '')).not.toContain('\0');

    alertMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Crystallize' }));
    await waitFor(() => expect(crystallizeRoutineRun).toHaveBeenCalledWith('r1', 'run-1'));
    await waitFor(() => {
      const msg = String(alertMock.mock.calls.at(-1)?.[0] ?? '');
      expect(msg).toMatch(/^Crystallized skill: skill x/);
      expect(msg).toContain('/path');
      expect(msg).not.toContain('\0');
    });

    alertMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Crystallize' }));
    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('diskfull now');
    });

    alertMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Crystallize' }));
    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('Crystallize failed');
    });
  });

  it('cancels crystallize when confirm is false', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({ ok: true, data: runs });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning Digest'));
    await waitFor(() => expect(listRoutineRuns).toHaveBeenCalled());
    const crystallize = screen.queryByRole('button', { name: 'Crystallize' });
    if (crystallize) {
      fireEvent.click(crystallize);
      expect(crystallizeRoutineRun).not.toHaveBeenCalled();
    }
  });

  it('surfaces scrubbed create throw, keeps modal open, re-enables Create', async () => {
    const user = userEvent.setup();
    listRoutines.mockResolvedValue({ ok: true, data: [] });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    createRoutine.mockRejectedValue(new Error(`create${'\n'}net${'\0'}!`));
    render(<Routines />);
    await waitFor(() => expect(screen.getByText(/No routines/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    await waitFor(() => expect(screen.getByText('New Routine')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Daily digest'), 'Throw Routine');
    fireEvent.change(screen.getByDisplayValue('— Select workflow —'), { target: { value: 'wf-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createRoutine).toHaveBeenCalled();
      expect(screen.getByText(/create net!/)).toBeInTheDocument();
    });
    expect(screen.getByText('New Routine')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled();
  });

  it('alerts scrubbed error when routine delete throws', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({ ok: true, data: [] });
    deleteRoutine.mockRejectedValue(new Error(`still${'\n'}running${'\0'}!`));
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning Digest'));
    await waitFor(() => expect(listRoutineRuns).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(deleteRoutine).toHaveBeenCalled();
      expect(alertMock).toHaveBeenCalledWith('still running!');
    });
    expect(String(alertMock.mock.calls.at(-1)?.[0] ?? '')).not.toContain('\0');
  });

  it('keeps routines list when listWorkflows throws', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: routines });
    listWorkflows.mockRejectedValue(new Error(`wf${'\n'}down${'\0'}!`));
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Morning Digest')).toBeInTheDocument());
    // Routines survived isolated workflows failure
    expect(screen.queryByText(/Failed to load routines/i)).not.toBeInTheDocument();
    expect(screen.getByText('Hourly Sync')).toBeInTheDocument();
  });

  it('surfaces scrubbed workflows load error in create modal', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: [] });
    listWorkflows.mockResolvedValue({
      ok: false,
      error: `wf${'\n'}catalog${'\0'}!`,
    });
    render(<Routines />);
    await waitFor(() => expect(screen.getByText(/No routines/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    await waitFor(() => expect(screen.getByText('New Routine')).toBeInTheDocument());
    expect(screen.getByText('wf catalog!')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
    // Workflow select disabled while catalog unavailable
    const select = screen.getByDisplayValue('— Select workflow —') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
  });

  it('surfaces workflows throw error without wiping empty routines list state', async () => {
    listRoutines.mockResolvedValue({ ok: true, data: [] });
    listWorkflows.mockRejectedValue(new Error(`net${'\n'}wf${'\0'}!`));
    render(<Routines />);
    await waitFor(() => expect(screen.getByText(/No routines/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '+ New' }));
    await waitFor(() => expect(screen.getByText('New Routine')).toBeInTheDocument());
    expect(screen.getByText('net wf!')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('rejects delete/toggle/run when routine id has control chars', async () => {
    listRoutines.mockResolvedValue({
      ok: true,
      data: [
        {
          id: `r${'\0'}evil`,
          name: 'Evil Routine',
          workflowId: 'wf-1',
          schedule: '0 9 * * *',
          timezone: 'UTC',
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    listRoutineRuns.mockResolvedValue({ ok: true, data: [] });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Routines />);
    await waitFor(() => expect(screen.getByText('Evil Routine')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Evil Routine'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deleteRoutine).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Routine id contains invalid control characters');

    alertSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(updateRoutine).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Routine id contains invalid control characters');

    alertSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Run Now/i }));
    expect(runRoutineNow).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Routine id contains invalid control characters');
    alertSpy.mockRestore();
  });

});
