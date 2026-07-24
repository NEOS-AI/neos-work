/**
 * Coverage for schedule lifecycle + runRoutine early exits / happy path.
 * node-cron.schedule is mocked so no real timers fire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listRoutines: vi.fn(),
  getRoutine: vi.fn(),
  setLastRunAt: vi.fn(),
  createRoutineRun: vi.fn(() => ({ id: 'rr-1' })),
  completeRoutineRun: vi.fn(),
  getWorkflow: vi.fn(),
  saveRun: vi.fn(),
  executeWorkflow: vi.fn(),
  getExecutionSettings: vi.fn(() => ({})),
  spawnCliAgent: vi.fn(),
  getDesignSystemContent: vi.fn(),
  getRuntimeAuthToken: vi.fn(() => 'tok'),
  getRuntimeServerUrl: vi.fn(() => 'http://127.0.0.1:3000'),
  createFirstHtmlArtifact: vi.fn(),
  createArtifact: vi.fn(),
  schedule: vi.fn(),
  validate: vi.fn((expr: string) => /^[\d*/,\- ]+$/.test(expr) && expr.trim().length > 0),
}));

vi.mock('node-cron', () => ({
  schedule: mocks.schedule,
  validate: mocks.validate,
}));

vi.mock('../db/routines.js', () => ({
  listRoutines: mocks.listRoutines,
  getRoutine: mocks.getRoutine,
  setLastRunAt: mocks.setLastRunAt,
  createRoutineRun: mocks.createRoutineRun,
  completeRoutineRun: mocks.completeRoutineRun,
}));

vi.mock('../db/workflows.js', () => ({
  getWorkflow: mocks.getWorkflow,
  saveRun: mocks.saveRun,
}));

vi.mock('@neos-work/workflow-engine', () => ({
  executeWorkflow: mocks.executeWorkflow,
}));

vi.mock('../db/settings.js', () => ({
  getExecutionSettings: mocks.getExecutionSettings,
}));

vi.mock('./cli-agents.js', () => ({
  spawnCliAgent: mocks.spawnCliAgent,
}));

vi.mock('./design-system-store.js', () => ({
  getDesignSystemContent: mocks.getDesignSystemContent,
}));

vi.mock('./runtime-context.js', () => ({
  getRuntimeAuthToken: mocks.getRuntimeAuthToken,
  getRuntimeServerUrl: mocks.getRuntimeServerUrl,
}));

vi.mock('./html-artifact.js', () => ({
  createFirstHtmlArtifact: mocks.createFirstHtmlArtifact,
}));

vi.mock('../db/artifacts.js', () => ({
  createArtifact: mocks.createArtifact,
}));

import {
  addOrUpdateSchedule,
  initScheduler,
  removeSchedule,
  runRoutine,
} from './routine-scheduler.js';

function makeTask() {
  return { stop: vi.fn(), start: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validate.mockImplementation(
    (expr: string) => /^[\d*/,\- ]+$/.test(expr) && expr.trim().length > 0,
  );
  mocks.schedule.mockImplementation(() => makeTask());
  mocks.listRoutines.mockReturnValue([]);
  mocks.getRoutine.mockReturnValue(null);
  mocks.getWorkflow.mockReturnValue(null);
  mocks.createRoutineRun.mockReturnValue({ id: 'rr-1' });
  mocks.executeWorkflow.mockResolvedValue(undefined);
  mocks.getDesignSystemContent.mockResolvedValue(null);
});

afterEach(() => {
  // ensure no leftover scheduled ids between tests
  removeSchedule('r1');
  removeSchedule('r2');
  removeSchedule('r-disabled');
  removeSchedule('r-invalid');
});

describe('addOrUpdateSchedule / removeSchedule', () => {
  it('schedules enabled routines with timezone', () => {
    addOrUpdateSchedule('r1', '0 9 * * *', true, 'Asia/Seoul');
    expect(mocks.validate).toHaveBeenCalledWith('0 9 * * *');
    expect(mocks.schedule).toHaveBeenCalledWith(
      '0 9 * * *',
      expect.any(Function),
      { timezone: 'Asia/Seoul' },
    );
    const task = mocks.schedule.mock.results[0]!.value as { start: ReturnType<typeof vi.fn> };
    expect(task.start).toHaveBeenCalled();
  });

  it('defaults blank timezone to UTC', () => {
    addOrUpdateSchedule('r1', '*/15 * * * *', true, '   ');
    expect(mocks.schedule).toHaveBeenCalledWith(
      '*/15 * * * *',
      expect.any(Function),
      { timezone: 'UTC' },
    );
  });

  it('ignores blank routine ids and trims schedule expression', () => {
    addOrUpdateSchedule('   ', '0 9 * * *', true, 'UTC');
    expect(mocks.schedule).not.toHaveBeenCalled();
    removeSchedule('   ');
    addOrUpdateSchedule('  r1  ', '  0 9 * * *  ', true, 'UTC');
    expect(mocks.validate).toHaveBeenCalledWith('0 9 * * *');
    expect(mocks.schedule).toHaveBeenCalledWith(
      '0 9 * * *',
      expect.any(Function),
      { timezone: 'UTC' },
    );
  });

  it('does not schedule invalid cron', () => {
    mocks.validate.mockReturnValue(false);
    addOrUpdateSchedule('r-invalid', 'not-cron', true, 'UTC');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('stops previous task when updating schedule', () => {
    const first = makeTask();
    const second = makeTask();
    mocks.schedule.mockReturnValueOnce(first).mockReturnValueOnce(second);
    addOrUpdateSchedule('r1', '0 9 * * *', true, 'UTC');
    addOrUpdateSchedule('r1', '0 10 * * *', true, 'UTC');
    expect(first.stop).toHaveBeenCalled();
    expect(mocks.schedule).toHaveBeenCalledTimes(2);
  });

  it('removes schedule when enabled=false', () => {
    const task = makeTask();
    mocks.schedule.mockReturnValue(task);
    addOrUpdateSchedule('r1', '0 9 * * *', true, 'UTC');
    addOrUpdateSchedule('r1', '0 9 * * *', false, 'UTC');
    expect(task.stop).toHaveBeenCalled();
  });

  it('removeSchedule stops and is idempotent', () => {
    const task = makeTask();
    mocks.schedule.mockReturnValue(task);
    addOrUpdateSchedule('r1', '0 9 * * *', true, 'UTC');
    removeSchedule('r1');
    expect(task.stop).toHaveBeenCalledTimes(1);
    removeSchedule('r1');
    expect(task.stop).toHaveBeenCalledTimes(1);
  });
});

describe('initScheduler', () => {
  it('schedules only enabled routines', () => {
    mocks.listRoutines.mockReturnValue([
      { id: 'r1', schedule: '0 9 * * *', timezone: 'UTC', enabled: true },
      { id: 'r-disabled', schedule: '0 10 * * *', timezone: 'UTC', enabled: false },
      { id: 'r2', schedule: '*/5 * * * *', timezone: 'America/New_York', enabled: true },
    ]);
    initScheduler();
    expect(mocks.schedule).toHaveBeenCalledTimes(2);
    expect(mocks.schedule).toHaveBeenCalledWith(
      '0 9 * * *',
      expect.any(Function),
      { timezone: 'UTC' },
    );
    expect(mocks.schedule).toHaveBeenCalledWith(
      '*/5 * * * *',
      expect.any(Function),
      { timezone: 'America/New_York' },
    );
  });
});

describe('runRoutine', () => {
  it('returns null for blank routine id', async () => {
    await expect(runRoutine('   ')).resolves.toBeNull();
    expect(mocks.getRoutine).not.toHaveBeenCalled();
  });

  it('returns null when routine missing', async () => {
    mocks.getRoutine.mockReturnValue(null);
    await expect(runRoutine('missing')).resolves.toBeNull();
    expect(mocks.createRoutineRun).not.toHaveBeenCalled();
  });

  it('returns null when routine disabled', async () => {
    mocks.getRoutine.mockReturnValue({
      id: 'r1',
      enabled: false,
      workflowId: 'wf1',
      inputs: {},
    });
    await expect(runRoutine('r1')).resolves.toBeNull();
    expect(mocks.createRoutineRun).not.toHaveBeenCalled();
  });

  it('returns null when workflow missing', async () => {
    mocks.getRoutine.mockReturnValue({
      id: 'r1',
      enabled: true,
      workflowId: 'wf-missing',
      inputs: {},
    });
    mocks.getWorkflow.mockReturnValue(null);
    await expect(runRoutine('r1')).resolves.toBeNull();
    expect(mocks.createRoutineRun).not.toHaveBeenCalled();
  });

  it('executes workflow, saves run, completes routine run', async () => {
    mocks.getRoutine.mockReturnValue({
      id: 'r1',
      enabled: true,
      workflowId: 'wf1',
      inputs: { q: 1 },
    });
    mocks.getWorkflow.mockReturnValue({
      id: 'wf1',
      designSystemId: undefined,
      nodes: [],
      edges: [],
    });
    mocks.executeWorkflow.mockImplementation(async (opts: {
      onEvent: (e: { type: string; nodeId: string; output?: unknown; error?: string }) => void;
    }) => {
      opts.onEvent({ type: 'node.completed', nodeId: 'n1', output: 'ok' });
      opts.onEvent({ type: 'node.failed', nodeId: 'n2', error: 'boom' });
    });

    const runId = await runRoutine('r1');
    expect(runId).toBeTruthy();
    expect(mocks.createRoutineRun).toHaveBeenCalledWith({ routineId: 'r1' });
    expect(mocks.setLastRunAt).toHaveBeenCalledWith('r1');
    expect(mocks.executeWorkflow).toHaveBeenCalled();
    expect(mocks.saveRun).toHaveBeenCalled();
    expect(mocks.createFirstHtmlArtifact).toHaveBeenCalled();
    expect(mocks.completeRoutineRun).toHaveBeenCalledWith('rr-1', 'completed');
  });

  it('loads design system content when designSystemId set', async () => {
    mocks.getRoutine.mockReturnValue({
      id: 'r1',
      enabled: true,
      workflowId: 'wf1',
      inputs: {},
    });
    mocks.getWorkflow.mockReturnValue({
      id: 'wf1',
      designSystemId: 'ds1',
      nodes: [],
      edges: [],
    });
    mocks.getDesignSystemContent.mockResolvedValue('# Brand');

    await runRoutine('r1');
    expect(mocks.getDesignSystemContent).toHaveBeenCalledWith('ds1');
    const call = mocks.executeWorkflow.mock.calls[0]![0] as { designSystemContent?: string };
    expect(call.designSystemContent).toBe('# Brand');
  });

  it('marks routine run failed when executeWorkflow throws', async () => {
    mocks.getRoutine.mockReturnValue({
      id: 'r1',
      enabled: true,
      workflowId: 'wf1',
      inputs: {},
    });
    mocks.getWorkflow.mockReturnValue({ id: 'wf1', nodes: [], edges: [] });
    mocks.executeWorkflow.mockRejectedValue(new Error('engine down'));

    const runId = await runRoutine('r1');
    expect(runId).toBeNull();
    expect(mocks.completeRoutineRun).toHaveBeenCalledWith('rr-1', 'failed', 'engine down');
    // Workflow run must not stay stuck as "running"
    const failedSave = mocks.saveRun.mock.calls
      .map((c) => c[0] as { status: string; error?: string; startedAt: string })
      .find((r) => r.status === 'failed');
    expect(failedSave).toBeTruthy();
    expect(failedSave!.error).toBe('engine down');
    expect(failedSave!.startedAt).toBeTruthy();
  });

  it('preserves startedAt between running and completed saves', async () => {
    mocks.getRoutine.mockReturnValue({
      id: 'r1',
      enabled: true,
      workflowId: 'wf1',
      inputs: {},
    });
    mocks.getWorkflow.mockReturnValue({ id: 'wf1', nodes: [], edges: [] });

    await runRoutine('r1');
    const saves = mocks.saveRun.mock.calls.map(
      (c) => c[0] as { status: string; startedAt: string },
    );
    const running = saves.find((s) => s.status === 'running');
    const completed = saves.find((s) => s.status === 'completed');
    expect(running?.startedAt).toBeTruthy();
    expect(completed?.startedAt).toBe(running!.startedAt);
  });
});
