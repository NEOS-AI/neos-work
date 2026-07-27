import { describe, expect, it, vi } from 'vitest';
import type { DomainWorker } from '@neos-work/shared';
import type { WorkerRunRequest, WorkerRunResult } from '../agent/worker-runtime.js';
import {
  CoordinatorSession,
  createCoordinatorTools,
  DEFAULT_MAX_SPAWNED_WORKERS,
  HARD_MAX_SPAWNED_WORKERS,
} from './worker-spawn.js';

function worker(id: string, domain = 'general'): DomainWorker {
  return {
    id,
    name: id,
    domain,
    description: `desc ${id}`,
    systemPrompt: 'You are a test worker.',
    permissionProfile: 'read_only',
    workspace: { kind: 'none' },
    defaultMode: 'solo',
  };
}

function catalog(): DomainWorker[] {
  return [
    worker('research_web', 'research'),
    worker('coding_reviewer', 'coding'),
    worker('general_coordinator', 'general'),
  ];
}

function makeSession(opts?: {
  maxSpawnedWorkers?: number;
  concurrency?: number;
  allowedWorkerIds?: string[];
  runChild?: (req: WorkerRunRequest) => Promise<WorkerRunResult>;
  signal?: AbortSignal;
}) {
  const workers = catalog();
  const runChild =
    opts?.runChild ??
    (async (req: WorkerRunRequest): Promise<WorkerRunResult> => ({
      ok: true,
      workerRunId: req.parent?.workerRunId ?? 'x',
      output: { echo: req.goal, workerId: req.worker.id, mode: req.mode },
      durationMs: 1,
      mode: 'solo',
    }));

  return new CoordinatorSession({
    resolveWorker: (id) => workers.find((w) => w.id === id),
    listWorkers: (domain) =>
      workers
        .filter((w) => !domain || w.domain === domain)
        .map((w) => ({
          id: w.id,
          name: w.name,
          domain: w.domain,
          description: w.description,
        })),
    runChild,
    parent: { nodeId: 'n1', runId: 'r1' },
    settings: {},
    maxSpawnedWorkers: opts?.maxSpawnedWorkers,
    concurrency: opts?.concurrency,
    allowedWorkerIds: opts?.allowedWorkerIds,
    signal: opts?.signal,
  });
}

describe('CoordinatorSession caps', () => {
  it('defaults maxSpawned to 4 and hard-caps at 8', () => {
    expect(makeSession().maxSpawned).toBe(DEFAULT_MAX_SPAWNED_WORKERS);
    expect(makeSession({ maxSpawnedWorkers: 99 }).maxSpawned).toBe(HARD_MAX_SPAWNED_WORKERS);
    expect(makeSession({ maxSpawnedWorkers: 0 }).maxSpawned).toBe(DEFAULT_MAX_SPAWNED_WORKERS);
  });
});

describe('spawn_worker / await_workers / list_workers', () => {
  it('spawns solo children and awaits results', async () => {
    const session = makeSession();
    const tools = Object.fromEntries(session.createTools().map((t) => [t.name, t]));

    const listed = await tools.list_workers!.execute({});
    expect(listed.success).toBe(true);
    const listOut = listed.output as { workers: Array<{ id: string }> };
    expect(listOut.workers.map((w) => w.id)).toEqual(
      expect.arrayContaining(['research_web', 'coding_reviewer']),
    );

    const byDomain = await tools.list_workers!.execute({ domain: 'research' });
    expect((byDomain.output as { workers: unknown[] }).workers).toHaveLength(1);

    const spawned = await tools.spawn_worker!.execute({
      workerId: 'research_web',
      goal: 'Find sources',
      inputs: { q: 'neos' },
    });
    expect(spawned.success).toBe(true);
    const { workerRunId, status } = spawned.output as {
      workerRunId: string;
      status: string;
    };
    expect(status).toBe('running');
    expect(workerRunId).toBeTruthy();

    const awaited = await tools.await_workers!.execute({
      workerRunIds: [workerRunId],
    });
    expect(awaited.success).toBe(true);
    const results = (awaited.output as { results: Array<{ ok: boolean; output: unknown }> })
      .results;
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.output).toMatchObject({
      echo: 'Find sources',
      workerId: 'research_web',
      mode: 'solo',
    });
  });

  it('forces child mode solo even if catalog worker is coordinator', async () => {
    const modes: Array<string | undefined> = [];
    const session = makeSession({
      runChild: async (req) => {
        modes.push(req.mode);
        expect(req.worker.defaultMode).toBe('solo');
        return {
          ok: true,
          workerRunId: req.parent!.workerRunId!,
          output: 'ok',
          durationMs: 1,
          mode: 'solo',
        };
      },
    });
    const spawn = session.createTools().find((t) => t.name === 'spawn_worker')!;
    await spawn.execute({ workerId: 'general_coordinator', goal: 'lead' });
    // wait for background
    await new Promise((r) => setTimeout(r, 20));
    expect(modes).toEqual(['solo']);
  });

  it('rejects unknown worker and over cap', async () => {
    const session = makeSession({ maxSpawnedWorkers: 2 });
    const spawn = session.createTools().find((t) => t.name === 'spawn_worker')!;

    const unknown = await spawn.execute({ workerId: 'nope', goal: 'x' });
    expect(unknown.success).toBe(false);
    expect(String(unknown.error)).toMatch(/Unknown worker/i);

    expect((await spawn.execute({ workerId: 'research_web', goal: 'a' })).success).toBe(true);
    expect((await spawn.execute({ workerId: 'coding_reviewer', goal: 'b' })).success).toBe(true);
    const over = await spawn.execute({ workerId: 'research_web', goal: 'c' });
    expect(over.success).toBe(false);
    expect(String(over.error)).toMatch(/maxSpawnedWorkers exceeded/i);
  });

  it('respects allowedWorkerIds allowlist', async () => {
    const session = makeSession({ allowedWorkerIds: ['coding_reviewer'] });
    const tools = Object.fromEntries(session.createTools().map((t) => [t.name, t]));
    const denied = await tools.spawn_worker!.execute({
      workerId: 'research_web',
      goal: 'x',
    });
    expect(denied.success).toBe(false);
    expect(String(denied.error)).toMatch(/allowedWorkerIds/i);

    const list = await tools.list_workers!.execute({});
    expect((list.output as { workers: Array<{ id: string }> }).workers.map((w) => w.id)).toEqual([
      'coding_reviewer',
    ]);
  });

  it('aborts in-flight children when parent signal aborts', async () => {
    const parent = new AbortController();
    let childSignal: AbortSignal | undefined;
    const session = makeSession({
      signal: parent.signal,
      runChild: async (req) => {
        childSignal = req.signal;
        await new Promise((r) => setTimeout(r, 200));
        if (req.signal?.aborted) {
          return {
            ok: false,
            workerRunId: req.parent!.workerRunId!,
            output: null,
            error: 'aborted',
            durationMs: 1,
            mode: 'solo',
          };
        }
        return {
          ok: true,
          workerRunId: req.parent!.workerRunId!,
          output: 'done',
          durationMs: 1,
          mode: 'solo',
        };
      },
    });
    const spawn = session.createTools().find((t) => t.name === 'spawn_worker')!;
    const spawned = await spawn.execute({ workerId: 'research_web', goal: 'slow' });
    const id = (spawned.output as { workerRunId: string }).workerRunId;
    parent.abort();
    session.abortAll();
    const awaitTool = session.createTools().find((t) => t.name === 'await_workers')!;
    const res = await awaitTool.execute({ workerRunIds: [id], timeoutMs: 5_000 });
    expect(res.success).toBe(true);
    const row = (res.output as { results: Array<{ ok: boolean; error?: string }> }).results[0]!;
    expect(row.ok).toBe(false);
    expect(childSignal?.aborted).toBe(true);
  });

  it('returns tool error for blank goal / missing ids', async () => {
    const session = makeSession();
    const tools = Object.fromEntries(session.createTools().map((t) => [t.name, t]));
    expect((await tools.spawn_worker!.execute({ workerId: 'research_web', goal: '  ' })).success).toBe(
      false,
    );
    expect((await tools.await_workers!.execute({ workerRunIds: [] })).success).toBe(false);
    const missing = await tools.await_workers!.execute({ workerRunIds: ['no-such'] });
    expect(missing.success).toBe(true);
    expect(
      (missing.output as { results: Array<{ error?: string }> }).results[0]!.error,
    ).toMatch(/Unknown workerRunId/i);
  });

  it('createCoordinatorTools factory returns session + tools', () => {
    const { session, tools } = createCoordinatorTools({
      resolveWorker: () => undefined,
      listWorkers: () => [],
      runChild: async () => ({
        ok: true,
        workerRunId: 'x',
        output: null,
        durationMs: 0,
        mode: 'solo',
      }),
      parent: { runId: 'r' },
      settings: {},
    });
    expect(session).toBeInstanceOf(CoordinatorSession);
    expect(tools.map((t) => t.name).sort()).toEqual([
      'await_workers',
      'list_workers',
      'spawn_worker',
    ]);
  });

  it('enforces concurrency semaphore without crashing the run', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const session = makeSession({
      concurrency: 1,
      maxSpawnedWorkers: 3,
      runChild: async (req) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 40));
        concurrent -= 1;
        return {
          ok: true,
          workerRunId: req.parent!.workerRunId!,
          output: 'ok',
          durationMs: 40,
          mode: 'solo',
        };
      },
    });
    const spawn = session.createTools().find((t) => t.name === 'spawn_worker')!;
    const ids: string[] = [];
    for (const goal of ['a', 'b', 'c']) {
      const r = await spawn.execute({ workerId: 'research_web', goal });
      ids.push((r.output as { workerRunId: string }).workerRunId);
    }
    const awaitTool = session.createTools().find((t) => t.name === 'await_workers')!;
    await awaitTool.execute({ workerRunIds: ids, timeoutMs: 10_000 });
    expect(maxConcurrent).toBe(1);
  });

  it('coerces non-string goals, truncates fat inputs, drops circular inputs', async () => {
    const seen: Array<{ goal: string; inputs?: Record<string, unknown> }> = [];
    const session = makeSession({
      runChild: async (req) => {
        seen.push({ goal: req.goal, inputs: req.inputs });
        return {
          ok: true,
          workerRunId: req.parent!.workerRunId!,
          output: 'ok',
          durationMs: 1,
          mode: 'solo',
        };
      },
    });
    const spawn = session.createTools().find((t) => t.name === 'spawn_worker')!;

    // Non-string goal coerced via String()
    const numGoal = await spawn.execute({
      workerId: 'research_web',
      goal: 12345 as unknown as string,
    });
    expect(numGoal.success).toBe(true);

    // Fat inputs → truncated preview object
    const fat = await spawn.execute({
      workerId: 'research_web',
      goal: 'fat',
      inputs: { blob: 'X'.repeat(300_000) },
    });
    expect(fat.success).toBe(true);

    // Circular inputs dropped (safeInputs catch)
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const circ = await spawn.execute({
      workerId: 'research_web',
      goal: 'circ',
      inputs: circular,
    });
    expect(circ.success).toBe(true);

    await new Promise((r) => setTimeout(r, 30));
    expect(seen.some((s) => s.goal === '12345')).toBe(true);
    const fatSeen = seen.find((s) => s.goal === 'fat');
    expect(fatSeen?.inputs).toMatchObject({ _truncated: true });
    const circSeen = seen.find((s) => s.goal === 'circ');
    expect(circSeen?.inputs).toBeUndefined();
  });

  it('rejects control-char workerId', async () => {
    const session = makeSession();
    const spawn = session.createTools().find((t) => t.name === 'spawn_worker')!;
    const ctrl = await spawn.execute({
      workerId: `research${'\n'}web`,
      goal: 'x',
    });
    expect(ctrl.success).toBe(false);
    expect(String(ctrl.error)).toMatch(/workerId is required/i);
  });

  it('rejects spawn when parent signal is already aborted', async () => {
    const parent = new AbortController();
    parent.abort();
    const session = makeSession({ signal: parent.signal });
    const spawn = session.createTools().find((t) => t.name === 'spawn_worker')!;
    const cancelled = await spawn.execute({
      workerId: 'research_web',
      goal: 'x',
    });
    expect(cancelled.success).toBe(false);
    expect(String(cancelled.error)).toMatch(/cancelled/i);
  });

  it('times out await_workers and reports errors', async () => {
    const session = makeSession({
      runChild: async (req) => {
        await new Promise((r) => setTimeout(r, 500));
        return {
          ok: true,
          workerRunId: req.parent!.workerRunId!,
          output: 'late',
          durationMs: 500,
          mode: 'solo',
        };
      },
    });
    const spawn = session.createTools().find((t) => t.name === 'spawn_worker')!;
    const spawned = await spawn.execute({ workerId: 'research_web', goal: 'slow' });
    const id = (spawned.output as { workerRunId: string }).workerRunId;
    const awaitTool = session.createTools().find((t) => t.name === 'await_workers')!;
    const res = await awaitTool.execute({ workerRunIds: [id], timeoutMs: 30 });
    expect(res.success).toBe(true);
    const row = (res.output as { results: Array<{ ok: boolean; error?: string }> }).results[0]!;
    expect(row.ok).toBe(false);
    expect(String(row.error ?? '')).toMatch(/timed out/i);
  });

  it('exposes spawned count and tracked ids; filters control-char list domain', async () => {
    const session = makeSession();
    const spawn = session.createTools().find((t) => t.name === 'spawn_worker')!;
    const r = await spawn.execute({ workerId: 'research_web', goal: 'track' });
    expect(r.success).toBe(true);
    expect(session.spawned).toBe(1);
    expect(session.trackedIds).toHaveLength(1);

    const list = session.createTools().find((t) => t.name === 'list_workers')!;
    // Control-char domain → list all (filter ignored)
    const all = await list.execute({ domain: `research${'\n'}` });
    expect((all.output as { workers: unknown[] }).workers.length).toBeGreaterThanOrEqual(3);
  });

  it('strips null bytes from goals', async () => {
    let seenGoal = '';
    const session = makeSession({
      runChild: async (req) => {
        seenGoal = req.goal;
        return {
          ok: true,
          workerRunId: req.parent!.workerRunId!,
          output: 'ok',
          durationMs: 1,
          mode: 'solo',
        };
      },
    });
    const spawn = session.createTools().find((t) => t.name === 'spawn_worker')!;
    await spawn.execute({
      workerId: 'research_web',
      goal: `hello${'\0'}world`,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(seenGoal).toBe('helloworld');
  });

  it('session.spawn accepts non-string goals directly (safeGoal coerce path)', async () => {
    let seenGoal = '';
    const session = makeSession({
      runChild: async (req) => {
        seenGoal = req.goal;
        return {
          ok: true,
          workerRunId: req.parent!.workerRunId!,
          output: 'ok',
          durationMs: 1,
          mode: 'solo',
        };
      },
    });
    // Bypass tool String() coercion — hit safeGoal(typeof !== 'string')
    const r = await session.spawn({
      workerId: 'research_web',
      goal: 99 as unknown as string,
    });
    expect(r.success).toBe(true);
    await new Promise((r2) => setTimeout(r2, 20));
    expect(seenGoal).toBe('99');
  });

  it('tool execute catch paths surface scrubbed errors', async () => {
    const session = makeSession();
    vi.spyOn(session, 'spawn').mockRejectedValueOnce(new Error('spawn boom'));
    vi.spyOn(session, 'awaitWorkers').mockRejectedValueOnce(new Error('await boom'));
    vi.spyOn(session, 'list').mockImplementationOnce(() => {
      throw new Error('list boom');
    });
    const tools = Object.fromEntries(session.createTools().map((t) => [t.name, t]));

    const s = await tools.spawn_worker!.execute({ workerId: 'research_web', goal: 'x' });
    expect(s.success).toBe(false);
    expect(String(s.error)).toMatch(/spawn boom/i);

    const a = await tools.await_workers!.execute({ workerRunIds: ['x'] });
    expect(a.success).toBe(false);
    expect(String(a.error)).toMatch(/await boom/i);

    const l = await tools.list_workers!.execute({});
    expect(l.success).toBe(false);
    expect(String(l.error)).toMatch(/list boom/i);
  });

  it('cancels queued spawn via parent abort and surfaces error on await', async () => {
    const parent = new AbortController();
    const session = makeSession({
      concurrency: 1,
      maxSpawnedWorkers: 3,
      signal: parent.signal,
      runChild: async (req) => {
        await new Promise((r) => setTimeout(r, 150));
        if (req.signal?.aborted) {
          return {
            ok: false,
            workerRunId: req.parent!.workerRunId!,
            output: null,
            error: 'aborted',
            durationMs: 1,
            mode: 'solo',
          };
        }
        return {
          ok: true,
          workerRunId: req.parent!.workerRunId!,
          output: 'ok',
          durationMs: 150,
          mode: 'solo',
        };
      },
    });
    // Occupy the only concurrency slot
    const first = await session.spawn({ workerId: 'research_web', goal: 'hold' });
    expect(first.success).toBe(true);
    const firstId = (first.output as { workerRunId: string }).workerRunId;

    // Second waits for slot — must resolve (not reject) when aborted mid-queue
    const secondP = session.spawn({ workerId: 'coding_reviewer', goal: 'queued' });
    await new Promise((r) => setTimeout(r, 20));
    parent.abort();
    session.abortAll();

    const second = await secondP;
    expect(second.success).toBe(true);
    const secondId = (second.output as { workerRunId: string }).workerRunId;

    // Drain both child promises via await_workers (no unhandled rejections)
    const res = await session.awaitWorkers({
      workerRunIds: [firstId, secondId],
      timeoutMs: 3_000,
    });
    expect(res.success).toBe(true);
    const results = (
      res.output as { results: Array<{ workerRunId: string; ok: boolean; error?: string }> }
    ).results;
    expect(results).toHaveLength(2);
    const queued = results.find((r) => r.workerRunId === secondId)!;
    expect(queued.ok).toBe(false);
    expect(String(queued.error ?? '')).toMatch(/cancel|slot|abort/i);
  });

  it('await_workers coerces non-array workerRunIds via tool wrapper', async () => {
    const session = makeSession();
    const awaitTool = session.createTools().find((t) => t.name === 'await_workers')!;
    const res = await awaitTool.execute({
      workerRunIds: 'not-array' as unknown as string[],
    });
    expect(res.success).toBe(false);
    expect(String(res.error)).toMatch(/workerRunIds is required/i);
  });

  it('rejects acquireSlot when child signal is already aborted before queueing', async () => {
    // Occupy the only concurrency slot with a long-running child
    const session = makeSession({
      concurrency: 1,
      maxSpawnedWorkers: 3,
      runChild: async (req) => {
        await new Promise((r) => setTimeout(r, 200));
        return {
          ok: true,
          workerRunId: req.parent!.workerRunId!,
          output: 'hold',
          durationMs: 200,
          mode: 'solo',
        };
      },
    });
    const first = await session.spawn({ workerId: 'research_web', goal: 'hold' });
    expect(first.success).toBe(true);

    // Second spawn starts, then abortAll before the async acquireSlot runs
    const secondP = session.spawn({ workerId: 'coding_reviewer', goal: 'queued-preabort' });
    // Microtask: children map is populated; abort child controller immediately
    session.abortAll();

    const second = await secondP;
    expect(second.success).toBe(true);
    const secondId = (second.output as { workerRunId: string }).workerRunId;

    const res = await session.awaitWorkers({
      workerRunIds: [secondId],
      timeoutMs: 3_000,
    });
    const row = (res.output as { results: Array<{ ok: boolean; error?: string }> }).results[0]!;
    expect(row.ok).toBe(false);
    expect(String(row.error ?? '')).toMatch(/cancel|slot|abort/i);
  });

  it('await_workers returns timed out when timeout fires before racing child promise', async () => {
    const session = makeSession({
      runChild: async (req) => {
        await new Promise((r) => setTimeout(r, 500));
        return {
          ok: true,
          workerRunId: req.parent!.workerRunId!,
          output: 'late',
          durationMs: 500,
          mode: 'solo',
        };
      },
    });
    const spawn = session.createTools().find((t) => t.name === 'spawn_worker')!;
    const a = await spawn.execute({ workerId: 'research_web', goal: 'a' });
    const b = await spawn.execute({ workerId: 'coding_reviewer', goal: 'b' });
    const idA = (a.output as { workerRunId: string }).workerRunId;
    const idB = (b.output as { workerRunId: string }).workerRunId;

    // Force setTimeout to abort immediately so map callbacks see aborted signal first
    const realSetTimeout = globalThis.setTimeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).setTimeout = (fn: (...args: unknown[]) => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    };
    try {
      const res = await session.awaitWorkers({
        workerRunIds: [idA, idB],
        timeoutMs: 1,
      });
      expect(res.success).toBe(true);
      const results = (res.output as { results: Array<{ ok: boolean; error?: string }> }).results;
      expect(results).toHaveLength(2);
      for (const row of results) {
        expect(row.ok).toBe(false);
        expect(String(row.error ?? '')).toMatch(/timed out/i);
      }
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });

  it('tool execute catch uses default message when scrubbed error is empty', async () => {
    const session = makeSession();
    // Non-Error whitespace throw → scrub → '' → fallback strings
    vi.spyOn(session, 'spawn').mockRejectedValueOnce('   \n  ');
    vi.spyOn(session, 'awaitWorkers').mockRejectedValueOnce('   ');
    vi.spyOn(session, 'list').mockImplementationOnce(() => {
      throw '  \t  ';
    });
    const tools = Object.fromEntries(session.createTools().map((t) => [t.name, t]));

    const s = await tools.spawn_worker!.execute({ workerId: 'research_web', goal: 'x' });
    expect(s.success).toBe(false);
    expect(s.error).toBe('spawn_worker failed');

    const a = await tools.await_workers!.execute({ workerRunIds: ['x'] });
    expect(a.success).toBe(false);
    expect(a.error).toBe('await_workers failed');

    const l = await tools.list_workers!.execute({});
    expect(l.success).toBe(false);
    expect(l.error).toBe('list_workers failed');
  });
});
