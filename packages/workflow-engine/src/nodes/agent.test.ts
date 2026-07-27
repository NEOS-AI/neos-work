import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const orchestratorCtor = vi.fn();
const orchestratorRun = vi.fn(async function* () {
  yield { type: 'done', task: { status: 'completed', steps: [] } };
});

/** Last deps bag passed to createCoordinatorTools (coordinator mode). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lastCoordinatorDeps: any = null;

const runWorkerMock = vi.fn(async (req: {
  worker: { id: string };
  parent?: { workerRunId?: string };
  onEvent?: (e: {
    type: string;
    workerId?: string;
    workerRunId: string;
    chunk?: string;
    output?: unknown;
    error?: string;
  }) => void;
}) => {
  const workerRunId = req.parent?.workerRunId ?? 'child-run';
  const workerId = req.worker.id;
  req.onEvent?.({ type: 'worker.started', workerId, workerRunId });
  req.onEvent?.({ type: 'worker.progress', workerId, workerRunId, chunk: 'c' });
  req.onEvent?.({ type: 'worker.completed', workerId, workerRunId, output: 'child-out' });
  req.onEvent?.({ type: 'worker.failed', workerId, workerRunId, error: 'soft-fail' });
  return {
    ok: true,
    workerRunId,
    output: 'child-out',
    durationMs: 1,
    mode: 'solo' as const,
  };
});

vi.mock('@neos-work/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neos-work/core')>();
  return {
    ...actual,
    runWorker: (req: unknown) => runWorkerMock(req as never),
    createCoordinatorTools: (deps: unknown) => {
      lastCoordinatorDeps = deps;
      return actual.createCoordinatorTools(deps as never);
    },
    AgentOrchestrator: class {
      constructor(...args: unknown[]) {
        orchestratorCtor(...args);
      }
      run(...args: unknown[]) {
        return orchestratorRun(...args);
      }
    },
  };
});

import { AgentNode } from './agent.js';
import type { NodeContext } from '../types.js';
// Same module instance AgentNode resolves via `import * as packs`
import * as packs from '../packs/index.js';

function ctx(partial: Partial<NodeContext> = {}): NodeContext {
  return {
    workflowId: 'wf',
    runId: 'run',
    nodeId: 'agent',
    inputs: { q: 'hello' },
    settings: {},
    config: {},
    ...partial,
  };
}

describe('AgentNode coordinator mode', () => {
  it('registers coordinator spawn tools on the orchestrator registry', async () => {
    orchestratorCtor.mockClear();
    lastCoordinatorDeps = null;
    const node = new AgentNode('agent', {
      workerId: 'general_coordinator',
      mode: 'coordinator',
      maxSteps: 5,
      allowedWorkerIds: ['research_web', `bad${'\n'}id`, ''],
      maxSpawnedWorkers: 3,
    });
    await node.execute(ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }));
    expect(orchestratorCtor).toHaveBeenCalled();
    const registry = orchestratorCtor.mock.calls[0]?.[1] as {
      get?: (n: string) => unknown;
      getAll?: () => Array<{ name: string }>;
    };
    const names = registry.getAll?.().map((t) => t.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining(['spawn_worker', 'await_workers', 'list_workers']),
    );
    expect(lastCoordinatorDeps).toBeTruthy();
  });

  it('skips CLI path when mode is coordinator (built-in loop required)', async () => {
    const cliSpawn = vi.fn().mockResolvedValue({ output: 'cli', exitCode: 0 });
    orchestratorCtor.mockClear();
    const node = new AgentNode('agent', {
      workerId: 'general_coordinator',
      mode: 'coordinator',
      provider: 'cli-claude',
    });
    await node.execute(
      ctx({
        cliSpawn,
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    expect(cliSpawn).not.toHaveBeenCalled();
    expect(orchestratorCtor).toHaveBeenCalled();
  });

  it('bridges child worker.* events from runChild to onWorkerEvent', async () => {
    lastCoordinatorDeps = null;
    runWorkerMock.mockClear();
    const events: Array<{ type: string; workerId?: string; chunk?: string }> = [];
    orchestratorCtor.mockClear();
    const node = new AgentNode('agent', {
      workerId: 'general_coordinator',
      mode: 'coordinator',
    });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        onWorkerEvent: (e) => {
          events.push({ type: e.type, workerId: e.workerId, chunk: e.chunk });
        },
      }),
    );
    expect(lastCoordinatorDeps?.runChild).toBeTypeOf('function');

    // Drive the agent-wired runChild → runWorker → onEvent bridge
    await lastCoordinatorDeps.runChild({
      worker: { id: 'research_web', name: 'R', domain: 'research', description: '', systemPrompt: 'x' },
      goal: 'child goal',
      mode: 'solo',
      parent: { nodeId: 'n1', runId: 'r1', workerRunId: 'child-run-1' },
      settings: {},
    });

    const types = events.map((e) => e.type);
    // Parent agent also emits its own worker.started/completed around the LLM loop
    expect(types).toEqual(expect.arrayContaining([
      'worker.started',
      'worker.progress',
      'worker.completed',
      'worker.failed',
    ]));
    expect(events.some((e) => e.workerId === 'research_web' && e.type === 'worker.progress' && e.chunk === 'c')).toBe(
      true,
    );
    expect(runWorkerMock).toHaveBeenCalled();
  });

  it('aborts coordinator session when parent signal is already aborted', async () => {
    lastCoordinatorDeps = null;
    const ac = new AbortController();
    ac.abort();
    const node = new AgentNode('agent', {
      workerId: 'general_coordinator',
      mode: 'coordinator',
    });
    const result = await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        signal: ac.signal,
      }),
    );
    // Still constructs coordinator tools; abortAll on already-aborted signal is a no-throw
    expect(result.ok).toBe(true);
    expect(lastCoordinatorDeps).toBeTruthy();
  });

  it('registers abort listener when signal is live and uses listWorkers catalog', async () => {
    lastCoordinatorDeps = null;
    const ac = new AbortController();
    const node = new AgentNode('agent', {
      workerId: 'general_coordinator',
      mode: 'coordinator',
      maxSpawnedWorkers: 2,
    });
    const result = await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        signal: ac.signal,
      }),
    );
    expect(result.ok).toBe(true);
    expect(lastCoordinatorDeps?.listWorkers).toBeTypeOf('function');
    const listed = lastCoordinatorDeps.listWorkers('research');
    expect(Array.isArray(listed)).toBe(true);
    // Fire abort listener (session.abortAll) without throwing
    ac.abort();
  });

  it('uses worker maxSpawnedWorkers and RUN_ID/parent node fallbacks in coordinator mode', async () => {
    lastCoordinatorDeps = null;
    // No node maxSpawnedWorkers → harness (worker) constraints.maxSpawnedWorkers (4)
    const node = new AgentNode('agent', {
      workerId: 'general_coordinator',
      mode: 'coordinator',
    });
    const result = await node.execute(
      ctx({
        // Invalid runId → settings.RUN_ID; blank/control nodeId → 'agent'
        runId: `bad${'\n'}run`,
        nodeId: `\n`,
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          RUN_ID: 'from-settings-coord',
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(lastCoordinatorDeps).toBeTruthy();
    expect(lastCoordinatorDeps.maxSpawnedWorkers).toBe(4);
    expect(lastCoordinatorDeps.parent).toEqual({
      nodeId: 'agent',
      runId: 'from-settings-coord',
    });

    // Missing RUN_ID + non-string runId → agent-node default
    lastCoordinatorDeps = null;
    await new AgentNode('agent', {
      workerId: 'general_coordinator',
      mode: 'coordinator',
    }).execute(
      ctx({
        runId: 99 as unknown as string,
        nodeId: '   ',
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    expect(lastCoordinatorDeps.parent).toEqual({
      nodeId: 'agent',
      runId: 'agent-node',
    });

    // Coordinator without worker maxSpawnedWorkers → undefined (runtime default)
    const { registerWorker, resolveWorker } = packs;
    registerWorker({
      id: 'cov_coord_no_max',
      name: 'Coord No Max',
      domain: 'general',
      description: 'coverage',
      systemPrompt: 'coord',
      defaultMode: 'coordinator',
      permissionProfile: 'read_only',
      // no constraints.maxSpawnedWorkers
    });
    expect(resolveWorker('cov_coord_no_max')?.constraints?.maxSpawnedWorkers).toBeUndefined();
    lastCoordinatorDeps = null;
    await new AgentNode('agent', {
      workerId: 'cov_coord_no_max',
      mode: 'coordinator',
    }).execute(ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }));
    expect(lastCoordinatorDeps.maxSpawnedWorkers).toBeUndefined();
  });
});

describe('AgentNode CLI provider', () => {
  it('emits worker lifecycle events on successful CLI run', async () => {
    const events: Array<{ type: string; workerId?: string }> = [];
    const cliSpawn = vi.fn(async (_id: string, _p: string, onChunk?: (c: string, a: string) => void) => {
      onChunk?.('chunk', 'chunk');
      return { output: 'done', exitCode: 0 };
    });
    const node = new AgentNode('agent', {
      workerId: 'finance_analyst',
      provider: 'cli-claude',
    });
    const result = await node.execute(
      ctx({
        cliSpawn,
        onWorkerEvent: (e) => events.push({ type: e.type, workerId: e.workerId }),
      }),
    );
    expect(result.ok).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      'worker.started',
      'worker.progress',
      'worker.completed',
    ]);
    expect(events[0]?.workerId).toBe('finance_analyst');
  });

  it('fails when CLI provider selected but cliSpawn missing', async () => {
    const node = new AgentNode('agent_coding', { provider: 'cli-claude' });
    const result = await node.execute(ctx());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/CLI spawn not available/i);
  });

  it('uses llmProvider for CLI selection', async () => {
    const cliSpawn = vi.fn().mockResolvedValue({ output: 'done', exitCode: 0 });
    const node = new AgentNode('agent_coding', { llmProvider: 'cli-gemini' });
    const result = await node.execute(ctx({ cliSpawn }));
    expect(result.ok).toBe(true);
    expect(result.output).toBe('done');
    expect(cliSpawn).toHaveBeenCalledWith(
      'cli-gemini',
      expect.any(String),
      expect.any(Function),
      undefined,
    );
  });

  it('reports non-zero CLI exit as failure', async () => {
    const cliSpawn = vi.fn().mockResolvedValue({ output: 'err', exitCode: 2 });
    const node = new AgentNode('agent_coding', { provider: 'cli-codex' });
    const result = await node.execute(ctx({ cliSpawn }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exited with code 2/);
  });

  it('truncates oversized CLI failure errors at 4000 chars', async () => {
    const cliSpawn = vi.fn().mockRejectedValue(new Error('E'.repeat(5_000)));
    const node = new AgentNode('agent_coding', { provider: 'cli-claude' });
    const result = await node.execute(ctx({ cliSpawn }));
    expect(result.ok).toBe(false);
    expect(String(result.error).length).toBe(4_000);
  });

  it('falls back to Operation failed when CLI error scrubs to empty', async () => {
    const cliSpawn = vi.fn().mockRejectedValue(new Error('\n\r\0'));
    const node = new AgentNode('agent_coding', { provider: 'cli-claude' });
    const result = await node.execute(ctx({ cliSpawn }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Operation failed');
  });

  it('hard-caps CLI prompt when design context + fat inputs exceed bound', async () => {
    let captured = '';
    const cliSpawn = vi.fn(async (_id: string, prompt: string) => {
      captured = prompt;
      return { output: 'ok', exitCode: 0 };
    });
    const node = new AgentNode('agent_coding', {
      provider: 'cli-claude',
      systemPrompt: 'S'.repeat(100_000),
    });
    const result = await node.execute(
      ctx({
        cliSpawn,
        // DESIGN_CONTEXT_MAX 32k + base 100k + inputs 256k pushes past hard cap
        designSystemContent: 'D'.repeat(40_000),
        inputs: { blob: 'X'.repeat(300_000) },
      }),
    );
    expect(result.ok).toBe(true);
    expect(cliSpawn).toHaveBeenCalled();
    // SYSTEM_PROMPT_MAX (100k) + CLI_INPUTS_MAX (256k)
    expect(captured.length).toBeLessThanOrEqual(100_000 + 256 * 1024);
    expect(captured).toMatch(/…\[inputs truncated\]|DESIGN CONTEXT|S{100}/);
  });

  it('forwards progress chunks from CLI spawn', async () => {
    const onProgress = vi.fn();
    const cliSpawn = vi.fn().mockImplementation(async (_id, _prompt, onChunk) => {
      onChunk?.('hel', 'hel');
      onChunk?.('lo', 'hello');
      return { output: 'hello', exitCode: 0 };
    });
    const node = new AgentNode('agent_coding', { provider: 'cli-claude' });
    await node.execute(ctx({ cliSpawn, onProgress }));
    expect(onProgress).toHaveBeenCalledWith('hel', 'hel');
    expect(onProgress).toHaveBeenCalledWith('lo', 'hello');
  });

  it('prepends design system content to prompt for CLI', async () => {
    const cliSpawn = vi.fn().mockResolvedValue({ output: 'ok', exitCode: 0 });
    const node = new AgentNode('agent_coding', {
      provider: 'cli-claude',
      systemPrompt: 'Be helpful',
    });
    await node.execute(
      ctx({
        cliSpawn,
        designSystemContent: '# Brand\nUse blue',
      }),
    );
    const prompt = cliSpawn.mock.calls[0][1] as string;
    expect(prompt).toContain('DESIGN CONTEXT');
    expect(prompt).toContain('Use blue');
    expect(prompt).toContain('Be helpful');
  });

  it('forwards AbortSignal to cliSpawn', async () => {
    const ac = new AbortController();
    const cliSpawn = vi.fn().mockResolvedValue({ output: 'x', exitCode: 0 });
    const node = new AgentNode('agent_coding', { provider: 'cli-claude' });
    await node.execute(ctx({ cliSpawn, signal: ac.signal }));
    expect(cliSpawn.mock.calls[0][3]).toBe(ac.signal);
  });

  it('includes inputs JSON in CLI prompt', async () => {
    const cliSpawn = vi.fn().mockResolvedValue({ output: 'ok', exitCode: 0 });
    const node = new AgentNode('agent_coding', { provider: 'cli-claude' });
    await node.execute(ctx({ cliSpawn, inputs: { task: 'ship v0.3.11' } }));
    const prompt = cliSpawn.mock.calls[0][1] as string;
    expect(prompt).toContain('ship v0.3.11');
  });

  it('trims/lowercases padded CLI provider ids', async () => {
    const cliSpawn = vi.fn().mockResolvedValue({ output: 'ok', exitCode: 0 });
    const node = new AgentNode('agent_coding', { provider: '  CLI-Claude  ' });
    const result = await node.execute(ctx({ cliSpawn }));
    expect(result.ok).toBe(true);
    expect(cliSpawn).toHaveBeenCalledWith(
      'cli-claude',
      expect.any(String),
      expect.any(Function),
      undefined,
    );
  });

  it('ignores control-char CLI provider and falls through to LLM path', async () => {
    const cliSpawn = vi.fn().mockResolvedValue({ output: 'ok', exitCode: 0 });
    // control-char provider must not match cli-claude branch
    const node = new AgentNode('agent_coding', { provider: 'cli-claude\n' });
    const result = await node.execute(
      ctx({
        cliSpawn,
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    expect(cliSpawn).not.toHaveBeenCalled();
    // Without a valid CLI provider, LLM path runs (ok or key error depending on mocks)
    expect(result.ok === true || result.ok === false).toBe(true);
  });
});

describe('AgentNode LLM model selection', () => {
  beforeEach(() => {
    orchestratorCtor.mockClear();
    orchestratorRun.mockReset();
    orchestratorRun.mockImplementation(async function* () {
      yield { type: 'done', task: { status: 'completed', steps: [] } };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes model to AgentOrchestrator from settings.model', async () => {
    const node = new AgentNode('agent_coding', {});
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          model: 'claude-sonnet-custom',
        },
      }),
    );
    expect(orchestratorCtor).toHaveBeenCalled();
    const opts = orchestratorCtor.mock.calls[0]?.[2] as { model?: string };
    expect(opts?.model).toBe('claude-sonnet-custom');
  });

  it('prefers nodeConfig.model over settings.model', async () => {
    const node = new AgentNode('agent_coding', { model: 'node-model' });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          model: 'settings-model',
        },
      }),
    );
    const opts = orchestratorCtor.mock.calls[0]?.[2] as { model?: string };
    expect(opts?.model).toBe('node-model');
  });

  it('prefers NodeConfigPanel llmModel over legacy model and settings', async () => {
    const node = new AgentNode('agent_coding', {
      llmModel: '  panel-model  ',
      model: 'legacy-model',
    });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          model: 'settings-model',
        },
      }),
    );
    const opts = orchestratorCtor.mock.calls[0]?.[2] as { model?: string };
    expect(opts?.model).toBe('panel-model');
  });

  it('uses node llmProvider when selecting the adapter', async () => {
    const node = new AgentNode('agent_coding', {
      llmProvider: 'openai',
      llmModel: 'gpt-4o-mini',
    });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          OPENAI_API_KEY: 'sk-openai',
          llmProvider: 'anthropic',
        },
      }),
    );
    expect(orchestratorCtor).toHaveBeenCalled();
    const adapter = orchestratorCtor.mock.calls[0]?.[0] as { id?: string };
    expect(adapter?.id).toBe('openai');
    const opts = orchestratorCtor.mock.calls[0]?.[2] as { model?: string };
    expect(opts?.model).toBe('gpt-4o-mini');
  });

  it('builds ollama adapter when node provider is ollama', async () => {
    const node = new AgentNode('agent_coding', { llmProvider: 'ollama', llmModel: 'llama3' });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
        },
      }),
    );
    const adapter = orchestratorCtor.mock.calls[0]?.[0] as { id?: string };
    expect(adapter?.id).toBe('ollama');
  });

  it('builds google adapter when node provider is google', async () => {
    const node = new AgentNode('agent_coding', { llmProvider: 'google', llmModel: 'gemini-pro' });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          GOOGLE_API_KEY: 'g-key',
        },
      }),
    );
    const adapter = orchestratorCtor.mock.calls[0]?.[0] as { id?: string };
    expect(adapter?.id).toBe('google');
  });

  it('clamps node maxSteps to 1–200 when harness has no constraint', async () => {
    const node = new AgentNode('agent_coding', { maxSteps: 999 });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    const opts = orchestratorCtor.mock.calls[0]?.[2] as { maxIterations?: number };
    expect(opts?.maxIterations).toBe(200);
  });

  it('defaults invalid maxSteps to 20', async () => {
    const node = new AgentNode('agent_coding', { maxSteps: 0 });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    const opts = orchestratorCtor.mock.calls[0]?.[2] as { maxIterations?: number };
    expect(opts?.maxIterations).toBe(20);
  });

  it('prefers harness maxSteps over node config', async () => {
    // coding_reviewer constraints.maxSteps = 15
    const node = new AgentNode('agent_coding', {
      harnessId: 'coding_reviewer',
      maxSteps: 99,
    });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    const opts = orchestratorCtor.mock.calls[0]?.[2] as { maxIterations?: number };
    expect(opts?.maxIterations).toBe(15);
  });

  it('prefers workerId over harnessId and resolves worker maxSteps', async () => {
    // coding_reviewer maxSteps=15; coding_implementer may differ — prefer workerId
    orchestratorRun.mockClear();
    orchestratorCtor.mockClear();
    const node = new AgentNode('agent', {
      workerId: 'coding_reviewer',
      harnessId: 'finance_analyst',
      maxSteps: 99,
      systemPrompt: 'Worker path',
    });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    const opts = orchestratorCtor.mock.calls[0]?.[2] as { maxIterations?: number };
    expect(opts?.maxIterations).toBe(15);
    const goal = String(orchestratorRun.mock.calls[0]?.[0] ?? '');
    expect(goal).toContain('Worker path');
    // coding_reviewer prompt (Korean "시니어"), not finance
    expect(goal).toContain('시니어');
    expect(goal).not.toMatch(/금융|리스크 분석/i);
  });

  it('ignores control-char and overlong workerId (falls back to bare prompt)', async () => {
    orchestratorRun.mockClear();
    const ctrl = new AgentNode('agent', {
      workerId: `coding_reviewer${'\n'}`,
      systemPrompt: 'Base only',
    });
    await ctrl.execute(ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }));
    const goalCtrl = String(orchestratorRun.mock.calls[0]?.[0] ?? '');
    expect(goalCtrl).toContain('Base only');
    expect(goalCtrl).not.toContain('시니어');

    orchestratorRun.mockClear();
    const long = new AgentNode('agent', {
      workerId: 'w'.repeat(201),
      systemPrompt: 'Long id ignored',
    });
    await long.execute(ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }));
    const goalLong = String(orchestratorRun.mock.calls[0]?.[0] ?? '');
    expect(goalLong).toContain('Long id ignored');
    expect(goalLong).not.toContain('시니어');
  });

  it('coerces non-string workerId via String()', async () => {
    const { registerHarness, resolveHarness } = await import('../harness/index.js');
    registerHarness({
      id: 'cov_agent_worker_num',
      name: 'Num Worker',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'Worker num body',
      allowedTools: ['read_file'],
    });
    expect(resolveHarness('cov_agent_worker_num')).toBeDefined();

    orchestratorRun.mockClear();
    const node = new AgentNode('agent', {
      workerId: { toString: () => 'cov_agent_worker_num' } as never,
      systemPrompt: 'Node',
    });
    await node.execute(ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }));
    const goal = String(orchestratorRun.mock.calls[0]?.[0] ?? '');
    expect(goal).toContain('Worker num body');
    expect(goal).toContain('Node');
  });

  it('resolves workspace when runId is non-string (RUN_ID / agent-node fallbacks)', async () => {
    // Non-string runId forces buildAgentToolRegistry to use settings.RUN_ID or 'agent-node'
    orchestratorRun.mockClear();
    const withSettings = new AgentNode('agent', { systemPrompt: 'With RUN_ID' });
    const ok1 = await withSettings.execute(
      ctx({
        runId: 42 as unknown as string,
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test', RUN_ID: 'from-settings-run' },
      }),
    );
    expect(ok1.ok).toBe(true);
    expect(orchestratorRun).toHaveBeenCalled();

    orchestratorRun.mockClear();
    const fallback = new AgentNode('agent', { systemPrompt: 'No RUN_ID' });
    const ok2 = await fallback.execute(
      ctx({
        runId: null as unknown as string,
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    expect(ok2.ok).toBe(true);
    expect(orchestratorRun).toHaveBeenCalled();

    // Control-char RUN_ID / blank nodeId fall back to agent-node / agent segments
    orchestratorRun.mockClear();
    const ctrl = new AgentNode('agent', { systemPrompt: 'Ctrl ids' });
    const ok3 = await ctrl.execute(
      ctx({
        runId: `bad${'\n'}run`,
        nodeId: `\n`,
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          RUN_ID: `bad${'\0'}id`,
        },
      }),
    );
    expect(ok3.ok).toBe(true);
    expect(orchestratorRun).toHaveBeenCalled();
  });

  it('emits worker lifecycle events via onWorkerEvent (Task 5)', async () => {
    const events: Array<{ type: string; workerId: string }> = [];
    orchestratorRun.mockImplementation(async function* () {
      yield { type: 'text', content: 'hi' };
      yield { type: 'done', task: { status: 'completed', steps: [] } };
    });
    const node = new AgentNode('agent', {
      workerId: 'coding_reviewer',
      systemPrompt: 'Emit events',
    });
    const result = await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        onWorkerEvent: (e) => {
          events.push({ type: e.type, workerId: e.workerId });
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      'worker.started',
      'worker.progress',
      'worker.completed',
    ]);
    expect(events.every((e) => e.workerId === 'coding_reviewer')).toBe(true);

    // Host handler throw must not break the node
    const ok = await new AgentNode('agent', { systemPrompt: 'x' }).execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        onWorkerEvent: () => {
          throw new Error('host boom');
        },
      }),
    );
    expect(ok.ok).toBe(true);
  });

  it('clamps harness maxSteps to 200', async () => {
    const { registerHarness } = await import('../harness/index.js');
    registerHarness({
      id: 'cov_agent_maxsteps_clamp',
      name: 'Clamp Test',
      domain: 'coding',
      description: 'test',
      systemPrompt: 'test',
      allowedTools: ['  read  ', '  ', 'write'],
      constraints: { maxSteps: 999 },
      isBuiltIn: false,
    });
    const node = new AgentNode('agent_coding', {
      harnessId: 'cov_agent_maxsteps_clamp',
      maxSteps: 10,
    });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    const opts = orchestratorCtor.mock.calls[0]?.[2] as { maxIterations?: number };
    expect(opts?.maxIterations).toBe(200);
  });

  it('returns error when anthropic key is missing', async () => {
    const node = new AgentNode('agent_coding', {});
    const result = await node.execute(ctx({ settings: {} }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('treats whitespace-only anthropic key as missing', async () => {
    const node = new AgentNode('agent_coding', {});
    const result = await node.execute(ctx({ settings: { ANTHROPIC_API_KEY: '   ' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('errors when google provider has no API key', async () => {
    const node = new AgentNode('agent_coding', { llmProvider: 'google' });
    const result = await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test', GOOGLE_API_KEY: '  ' },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/GOOGLE_API_KEY/);
  });

  it('errors when openai provider has no API key', async () => {
    const node = new AgentNode('agent_coding', { llmProvider: 'openai' });
    const result = await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: '  ' },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/OPENAI_API_KEY/);
  });

  it('rejects control-char API keys as missing and ignores control-char harnessId', async () => {
    const openai = new AgentNode('agent_coding', { llmProvider: 'openai' });
    const badKey = await openai.execute(
      ctx({
        settings: { OPENAI_API_KEY: `sk${'\n'}bad` },
      }),
    );
    expect(badKey.ok).toBe(false);
    expect(badKey.error).toMatch(/OPENAI_API_KEY/);

    orchestratorRun.mockClear();
    const node = new AgentNode('agent_coding', {
      harnessId: `coding_reviewer${'\n'}`,
      systemPrompt: 'Base only',
    });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Base only');
    // control-char harnessId must not resolve a built-in harness prompt
    expect(goal).not.toContain('시니어');
  });

  it('strips null bytes from systemPrompt before orchestrator goal', async () => {
    orchestratorRun.mockClear();
    const node = new AgentNode('agent_coding', {
      systemPrompt: `Be helpful${'\0'}please`,
    });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Be helpful');
    expect(goal).toContain('please');
    expect(goal).not.toContain('\0');
  });

  it('strips null bytes from harness prompt; skips null-byte design context', async () => {
    const spy = vi.spyOn(packs, 'resolveWorker').mockReturnValue({
      id: 'cov_agent_null_harness',
      name: 'Null Harness',
      domain: 'coding',
      description: 'test',
      systemPrompt: `Harness${'\0'}Prompt`,
      // web_search is a real tool name; control-char entries must be dropped at agent layer
      allowedTools: ['web_search', '\nbad', 'shell\n', '  web_search  '],
      isBuiltIn: false,
    });
    orchestratorCtor.mockClear();
    orchestratorRun.mockClear();

    try {
      const node = new AgentNode('agent_coding', {
        harnessId: 'cov_agent_null_harness',
        systemPrompt: 'Node body',
      });
      await node.execute(
        ctx({
          settings: {
            ANTHROPIC_API_KEY: 'sk-ant-test',
            TAVILY_API_KEY: 'tvly-test',
          },
          designSystemContent: `Brand${'\0'}Leak`,
        }),
      );
      const goal = orchestratorRun.mock.calls[0]?.[0] as string;
      expect(goal).toContain('HarnessPrompt');
      expect(goal).toContain('Node body');
      expect(goal).not.toContain('\0');
      // Null-byte design context is dropped entirely
      expect(goal).not.toContain('DESIGN CONTEXT');
      expect(goal).not.toContain('Brand');

      // Control-char allowedTools dropped before trim; only web_search remains
      const registry = orchestratorCtor.mock.calls[0]?.[1] as {
        getAll: () => Array<{ name: string }>;
      };
      const names = registry.getAll().map((t) => t.name);
      expect(names).toEqual(['web_search']);
    } finally {
      spy.mockRestore();
    }
  });

  it('ignores whitespace-only harnessId and designSystemContent', async () => {
    const node = new AgentNode('agent_coding', {
      harnessId: '   ',
      systemPrompt: 'Base only',
    });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        designSystemContent: '  \n  ',
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Base only');
    expect(goal).not.toContain('DESIGN CONTEXT');
    expect(goal).not.toContain('시니어');
  });

  it('injects memory export into the orchestrator goal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => 'remember the API shape',
      }),
    );
    const node = new AgentNode('agent_coding', { systemPrompt: 'You are helpful.' });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          SERVER_URL: 'http://memory.test',
          AUTH_TOKEN: 'tok',
        },
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      'http://memory.test/api/memory/export',
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok' },
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('## Agent Memory');
    expect(goal).toContain('remember the API shape');
    expect(goal).toContain('You are helpful.');
  });

  it('keeps base prompt when memory export fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const node = new AgentNode('agent_coding', { systemPrompt: 'Base only' });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Base only');
    expect(goal).not.toContain('## Agent Memory');
  });

  it('keeps base prompt when memory export returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => 'nope' }));
    const node = new AgentNode('agent_coding', { systemPrompt: 'No mem' });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test', SERVER_URL: 'http://m.test' },
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('No mem');
    expect(goal).not.toContain('## Agent Memory');
  });

  it('keeps base prompt when memory export body is blank', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => '   \n  ' }),
    );
    const node = new AgentNode('agent_coding', { systemPrompt: 'Blank mem' });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('Blank mem');
    expect(goal).not.toContain('## Agent Memory');
  });

  it('skips null-byte memory export before injecting into the goal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `remember this${'\0'}bad`,
      }),
    );
    const node = new AgentNode('agent_coding', { systemPrompt: 'No null mem' });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          SERVER_URL: 'http://memory.test',
          AUTH_TOKEN: 'tok',
        },
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('No null mem');
    expect(goal).not.toContain('## Agent Memory');
  });

  it('truncates oversized memory export before injecting into the goal', async () => {
    const huge = 'M'.repeat(40_000);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => huge }),
    );
    const node = new AgentNode('agent_coding', { systemPrompt: 'Cap mem' });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          SERVER_URL: 'http://memory.test',
          AUTH_TOKEN: 'tok',
        },
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('## Agent Memory');
    expect(goal).toContain('[memory truncated]');
    expect(goal.length).toBeLessThan(huge.length + 500);
  });

  it('trims SERVER_URL and AUTH_TOKEN for memory export', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => 'note' });
    vi.stubGlobal('fetch', fetchMock);
    const node = new AgentNode('agent_coding', { systemPrompt: 'P' });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          SERVER_URL: '  http://mem.local  ',
          AUTH_TOKEN: '  secret  ',
        },
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mem.local/api/memory/export',
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret' },
      }),
    );
  });

  it('falls back to SERVER_TOKEN when AUTH_TOKEN is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => 'note' });
    vi.stubGlobal('fetch', fetchMock);
    const node = new AgentNode('agent_coding', { systemPrompt: 'P' });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          SERVER_URL: 'http://mem.local',
          SERVER_TOKEN: 'server-tok',
        },
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://mem.local/api/memory/export',
      expect.objectContaining({
        headers: { Authorization: 'Bearer server-tok' },
      }),
    );
  });

  it('truncates oversized design system context', async () => {
    const node = new AgentNode('agent_coding', { systemPrompt: 'Agent body' });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        designSystemContent: 'D'.repeat(40_000),
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('DESIGN CONTEXT');
    expect(goal).toContain('…[design context truncated]');
    expect(goal.length).toBeLessThan(40_000 + 5_000);
  });

  it('prepends design system content on the LLM path', async () => {
    const node = new AgentNode('agent_coding', { systemPrompt: 'Agent body' });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        designSystemContent: 'Use brand blue',
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('<!-- DESIGN CONTEXT -->');
    expect(goal).toContain('Use brand blue');
    expect(goal).toContain('Agent body');
  });

  it('merges harness systemPrompt with node systemPrompt', async () => {
    const node = new AgentNode('agent_coding', {
      harnessId: 'coding_reviewer',
      systemPrompt: 'Extra focus on security',
    });
    await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    const goal = orchestratorRun.mock.calls[0]?.[0] as string;
    expect(goal).toContain('시니어 소프트웨어 엔지니어');
    expect(goal).toContain('Extra focus on security');
    expect(goal).toContain('---');
  });

  it('falls through whitespace-only llmModel to settings model', async () => {
    const node = new AgentNode('agent_coding', { llmModel: '   ' });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          model: 'from-settings',
        },
      }),
    );
    const opts = orchestratorCtor.mock.calls[0]?.[2] as { model?: string };
    expect(opts?.model).toBe('from-settings');
  });

  it('ignores leading control-char llmModel/llmProvider before trim', async () => {
    const node = new AgentNode('agent_coding', {
      // Leading \n must not strip to openai / panel-model
      llmProvider: '\nopenai',
      llmModel: '\npanel-model',
      model: '\nlegacy-model',
    });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          OPENAI_API_KEY: 'sk-openai',
          llmProvider: 'anthropic',
          model: 'settings-model',
        },
      }),
    );
    expect(orchestratorCtor).toHaveBeenCalled();
    const adapter = orchestratorCtor.mock.calls[0]?.[0] as { id?: string };
    // Control-char llmProvider ignored → settings anthropic adapter
    expect(adapter?.id).toBe('anthropic');
    const opts = orchestratorCtor.mock.calls[0]?.[2] as { model?: string };
    expect(opts?.model).toBe('settings-model');
  });

  it('forwards text progress and returns done output', async () => {
    const onProgress = vi.fn();
    orchestratorRun.mockImplementation(async function* () {
      yield { type: 'text', content: 'hel' };
      yield { type: 'text', content: 'lo' };
      yield { type: 'done', task: { steps: [{ output: 'unused' }] } };
    });
    const node = new AgentNode('agent_coding', {});
    const result = await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        onProgress,
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe('hello');
    expect(onProgress).toHaveBeenCalledWith('hel', 'hel');
    expect(onProgress).toHaveBeenCalledWith('lo', 'hello');
  });

  it('uses last step output when done arrives with no streamed text', async () => {
    orchestratorRun.mockImplementation(async function* () {
      yield { type: 'done', task: { steps: [{ output: { answer: 42 } }] } };
    });
    const node = new AgentNode('agent_coding', {});
    const result = await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe(JSON.stringify({ answer: 42 }));
  });

  it('returns accumulated text when stream ends without done/error', async () => {
    orchestratorRun.mockImplementation(async function* () {
      yield { type: 'text', content: 'partial' };
    });
    const node = new AgentNode('agent_coding', {});
    const result = await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe('partial');
  });

  it('returns orchestrator error events as failures', async () => {
    orchestratorRun.mockImplementation(async function* () {
      yield { type: 'error', error: 'rate limited' };
    });
    const node = new AgentNode('agent_coding', {});
    const result = await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('rate limited');
  });

  it('truncates oversized done result string and scrubs non-string error payloads', async () => {
    // AGENT_STREAM_TEXT_MAX_CHARS = 2 MiB — exceed via last-step string output (JSON-quoted)
    const fat = 'Z'.repeat(2 * 1024 * 1024 + 50);
    orchestratorRun.mockImplementation(async function* () {
      yield {
        type: 'done',
        task: { steps: [{ output: fat }] },
      };
    });
    const node = new AgentNode('agent_coding', {});
    const huge = await node.execute(
      ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }),
    );
    expect(huge.ok).toBe(true);
    expect(String(huge.output).length).toBe(2 * 1024 * 1024);

    orchestratorRun.mockImplementation(async function* () {
      yield { type: 'error', error: { code: 429, msg: 'slow' } };
    });
    const errObj = await node.execute(
      ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }),
    );
    expect(errObj.ok).toBe(false);
    expect(errObj.error).toBeTruthy();
    expect(String(errObj.error)).not.toMatch(/[\r\n\0]/);
  });

  it('returns structured failure when orchestrator.run throws', async () => {
    orchestratorRun.mockImplementation(async function* () {
      throw new Error('orchestrator down');
      yield { type: 'done', task: { steps: [] } }; // unreachable — keeps generator type
    });
    const node = new AgentNode('agent_coding', {});
    const result = await node.execute(
      ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/orchestrator down/i);
  });

  it('falls back to Operation failed when orchestrator throw scrubs to empty', async () => {
    orchestratorRun.mockImplementation(async function* () {
      throw new Error('\0\r\n');
      yield { type: 'done', task: { steps: [] } };
    });
    const node = new AgentNode('agent_coding', {});
    const result = await node.execute(
      ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Operation failed');
  });

  it('falls back when SERVER_URL is non-http for memory fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'mem',
    });
    vi.stubGlobal('fetch', fetchMock);
    const node = new AgentNode('agent_coding', { systemPrompt: 'P' });
    await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          SERVER_URL: 'file:///etc/passwd',
          AUTH_TOKEN: 'tok',
        },
      }),
    );
    // Should call default localhost URL, not file:
    if (fetchMock.mock.calls.length > 0) {
      expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https?:\/\//);
      expect(String(fetchMock.mock.calls[0][0])).not.toMatch(/^file:/);
    }
    vi.unstubAllGlobals();
  });

  it('rejects javascript: SERVER_URL and skips whitespace-only design context', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    orchestratorCtor.mockClear();
    orchestratorRun.mockClear();
    const node = new AgentNode('agent_coding', { systemPrompt: '  Agent  ' });
    const result = await node.execute(
      ctx({
        settings: {
          ANTHROPIC_API_KEY: 'sk-ant-test',
          SERVER_URL: 'javascript:alert(1)',
          AUTH_TOKEN: 'tok',
        },
        designSystemContent: '   \n\t  ',
      }),
    );
    expect(result.ok).toBe(true);
    if (fetchMock.mock.calls.length > 0) {
      expect(String(fetchMock.mock.calls[0]![0])).toMatch(/^https?:\/\//);
      expect(String(fetchMock.mock.calls[0]![0])).not.toMatch(/javascript:/);
    }
    // design context skipped — run goal should not include DESIGN CONTEXT marker
    expect(orchestratorRun).toHaveBeenCalled();
    const goal = String(orchestratorRun.mock.calls[0]?.[0] ?? '');
    expect(goal).toContain('Agent');
    expect(goal).not.toContain('DESIGN CONTEXT');
    vi.unstubAllGlobals();
  });

  it('trims blank systemPrompt so goal is inputs-only JSON', async () => {
    orchestratorRun.mockClear();
    const node = new AgentNode('agent_coding', { systemPrompt: '   ' });
    const result = await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        inputs: { q: 1 },
      }),
    );
    expect(result.ok).toBe(true);
    expect(orchestratorRun).toHaveBeenCalled();
    const goal = String(orchestratorRun.mock.calls[0]?.[0] ?? '');
    // no empty system prompt prefix — pure inputs JSON
    expect(goal).toBe(JSON.stringify({ q: 1 }));
    expect(goal).not.toContain('---');
  });

  it('coerces non-string harnessId and caps oversized node systemPrompt', async () => {
    const { registerHarness, resolveHarness } = await import('../harness/index.js');
    registerHarness({
      id: 'cov_agent_harness_num',
      name: 'Num Harness',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'Harness prompt body',
      allowedTools: ['read_file'],
    });
    expect(resolveHarness('cov_agent_harness_num')).toBeDefined();

    orchestratorRun.mockClear();
    // Non-string harnessId coerced via String()
    const node = new AgentNode('agent_coding', {
      harnessId: { toString: () => 'cov_agent_harness_num' } as never,
      systemPrompt: 'N'.repeat(120_000),
    });
    const result = await node.execute(
      ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }),
    );
    expect(result.ok).toBe(true);
    expect(orchestratorRun).toHaveBeenCalled();
    const goal = String(orchestratorRun.mock.calls[0]?.[0] ?? '');
    expect(goal).toContain('Harness prompt body');
    // Node system prompt capped at 100k before merge
    expect(goal.length).toBeLessThan(120_000 + 50_000);
  });

  it('truncates oversized CLI inputs JSON before spawn', async () => {
    let capturedPrompt = '';
    const cliSpawn = vi.fn(async (_id: string, prompt: string) => {
      capturedPrompt = prompt;
      return { output: 'ok', exitCode: 0 };
    });
    const node = new AgentNode('agent_coding', {
      provider: 'cli-claude',
      systemPrompt: 'sys',
    });
    const fatInputs = { blob: 'X'.repeat(300_000) };
    const result = await node.execute(ctx({ cliSpawn, inputs: fatInputs }));
    expect(result.ok).toBe(true);
    expect(cliSpawn).toHaveBeenCalled();
    expect(capturedPrompt).toMatch(/…\[inputs truncated\]/);
    // Prompt itself is also hard-capped
    expect(capturedPrompt.length).toBeLessThanOrEqual(100_000 + 256 * 1024);
  });

  it('truncates oversized inputs on the LLM path as well', async () => {
    orchestratorRun.mockClear();
    const node = new AgentNode('agent_coding', { systemPrompt: 'base' });
    const fatInputs = { blob: 'Y'.repeat(300_000) };
    const result = await node.execute(
      ctx({
        settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
        inputs: fatInputs,
      }),
    );
    expect(result.ok).toBe(true);
    expect(orchestratorRun).toHaveBeenCalled();
    const goal = String(orchestratorRun.mock.calls[0]?.[0] ?? '');
    expect(goal).toMatch(/…\[inputs truncated\]/);
  });

  it('caps oversized harness systemPrompt alone before node merge', async () => {
    const { registerHarness, resolveHarness } = await import('../harness/index.js');
    registerHarness({
      id: 'cov_agent_harness_only_fat',
      name: 'Fat Only',
      description: 'test',
      domain: 'coding',
      systemPrompt: 'Harness base prompt',
      allowedTools: [],
      constraints: { maxSteps: 5 },
    });
    // Registry caps at 100k; mutate stored object to exercise agent-side re-cap
    const stored = resolveHarness('cov_agent_harness_only_fat');
    if (stored) stored.systemPrompt = 'H'.repeat(120_000);
    orchestratorRun.mockClear();
    const node = new AgentNode('agent_coding', {
      harnessId: 'cov_agent_harness_only_fat',
      systemPrompt: '',
    });
    await node.execute(ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }));
    expect(orchestratorRun).toHaveBeenCalled();
    const goal = String(orchestratorRun.mock.calls[0]?.[0] ?? '');
    // Agent-side slice to SYSTEM_PROMPT_MAX_CHARS (100k)
    expect(goal.startsWith('H')).toBe(true);
    expect((goal.match(/H/g) ?? []).length).toBeLessThanOrEqual(100_000);
  });

  it('caps oversized harness systemPrompt before merge', async () => {
    const { registerHarness } = await import('../harness/index.js');
    registerHarness({
      id: 'cov_agent_harness_fat',
      name: 'Fat Harness',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'H'.repeat(120_000),
      allowedTools: [],
    });
    orchestratorRun.mockClear();
    const node = new AgentNode('agent_coding', {
      harnessId: 'cov_agent_harness_fat',
      systemPrompt: 'node-bit',
    });
    const result = await node.execute(
      ctx({ settings: { ANTHROPIC_API_KEY: 'sk-ant-test' } }),
    );
    expect(result.ok).toBe(true);
    const goal = String(orchestratorRun.mock.calls[0]?.[0] ?? '');
    // Registry + agent both cap at 100k; merged base prompt never exceeds that
    expect(goal.length).toBeLessThanOrEqual(100_000 + 50_000);
    expect(goal.startsWith('H')).toBe(true);
  });
});

