import { describe, expect, it } from 'vitest';
import type { ChatChunk, ChatParams } from '@neos-work/shared';
import { AgentOrchestrator } from './orchestrator.js';
import { ToolRegistry } from '../tools/registry.js';
import { mockAdapter } from '../test-utils/mock-adapter.js';
import type { LLMProviderAdapter } from '../llm/provider.js';
import type { AgentStep } from './types.js';

/** Adapter that returns different text per chat() call index. */
function sequencedAdapter(responses: string[]): LLMProviderAdapter {
  let call = 0;
  return {
    id: 'openai',
    name: 'Mock',
    getModels: () => [
      {
        id: 'mock-model',
        name: 'Mock',
        providerId: 'openai',
        contextWindow: 128_000,
        supportsThinking: false,
        supportsTools: true,
        supportsVision: false,
      },
    ],
    async *chat(_params: ChatParams): AsyncIterable<ChatChunk> {
      const text = responses[call] ?? responses[responses.length - 1] ?? '';
      call += 1;
      if (text) yield { type: 'text', content: text };
      yield { type: 'done' };
    },
    async validateApiKey() {
      return true;
    },
  };
}

async function collectEvents(run: AsyncGenerator) {
  const events: Array<{ type: string }> = [];
  for await (const event of run) {
    events.push(event as { type: string });
  }
  return events;
}

function step(partial: Partial<AgentStep> & { description: string }): AgentStep {
  return {
    id: partial.id ?? crypto.randomUUID(),
    index: partial.index ?? 0,
    description: partial.description,
    type: partial.type ?? 'plan',
    status: partial.status ?? 'pending',
    toolName: partial.toolName,
    input: partial.input,
  };
}

/** Inject planned steps so direct toolName+input path is reachable. */
function injectPlan(orch: AgentOrchestrator, steps: AgentStep[]) {
  // Planner is private — override for unit tests of healing / direct execution.
  (orch as unknown as { planner: { plan: () => Promise<AgentStep[]> } }).planner = {
    plan: async () => steps.map((s, i) => ({ ...s, index: i })),
  };
}

describe('AgentOrchestrator options', () => {
  it('clamps maxIterations and defaults invalid values; trims model', () => {
    const adapter = mockAdapter(['[]']);
    const reg = new ToolRegistry();

    const def = new AgentOrchestrator(adapter, reg, { maxIterations: Number.NaN });
    expect((def as unknown as { maxIterations: number }).maxIterations).toBe(10);

    const neg = new AgentOrchestrator(adapter, reg, { maxIterations: -3 });
    expect((neg as unknown as { maxIterations: number }).maxIterations).toBe(10);

    const high = new AgentOrchestrator(adapter, reg, { maxIterations: 999 });
    expect((high as unknown as { maxIterations: number }).maxIterations).toBe(200);

    const zero = new AgentOrchestrator(adapter, reg, { maxIterations: 0 });
    expect((zero as unknown as { maxIterations: number }).maxIterations).toBe(0);

    const model = new AgentOrchestrator(adapter, reg, { model: '  custom-model  ' });
    expect((model as unknown as { model: string }).model).toBe('custom-model');

    const blankModel = new AgentOrchestrator(adapter, reg, { model: '   ' });
    expect((blankModel as unknown as { model: string }).model).toBe('mock-model');
  });
});

describe('AgentOrchestrator', () => {
  it('cancels before planning when signal already aborted', async () => {
    const registry = new ToolRegistry();
    const orch = new AgentOrchestrator(mockAdapter(['[]']), registry);
    const controller = new AbortController();
    controller.abort();
    const events = await collectEvents(orch.run('do something', controller.signal));
    expect(events.map((e) => e.type)).toEqual(['error']);
    expect((events[0] as { error: string }).error).toMatch(/Cancelled before planning/);
  });

  it('rejects blank/whitespace goals before planning', async () => {
    const registry = new ToolRegistry();
    const orch = new AgentOrchestrator(mockAdapter(['[]']), registry);
    const events = await collectEvents(orch.run('   '));
    expect(events.map((e) => e.type)).toEqual(['error']);
    expect((events[0] as { error: string }).error).toMatch(/Goal is required/i);
  });

  it('plans, executes a tool step with input, synthesizes, and completes', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      async execute(input) {
        return { success: true, output: { echoed: input.text } };
      },
    });

    // chat call order: plan → (optional step LLM unused when toolName+input) → synthesize
    // Steps with toolName + input skip LLM in executeStep.
    // But plan returns steps without input — so executeStep uses LLM.
    // Provide plan with toolName only; LLM will emit tool_use for echo.
    const adapter = sequencedAdapter([
      JSON.stringify([{ description: 'Echo hello', toolName: 'echo' }]),
      // executeStep LLM path — emit tool_use then done
    ]);
    // Override chat for second call to yield tool_use
    let call = 0;
    const baseChat = adapter.chat.bind(adapter);
    adapter.chat = async function* (params) {
      call += 1;
      if (call === 1) {
        // plan
        yield* baseChat(params);
        return;
      }
      if (call === 2) {
        // execute step
        yield {
          type: 'tool_use',
          toolName: 'echo',
          toolUseId: 'tu1',
          toolInput: { text: 'hello' },
        };
        yield { type: 'done' };
        return;
      }
      // synthesize
      yield { type: 'text', content: 'All done.' };
      yield { type: 'done' };
    };

    const orch = new AgentOrchestrator(adapter, registry);
    const events = await collectEvents(orch.run('Say hello'));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('plan');
    expect(types).toContain('step_start');
    expect(types).toContain('step_complete');
    expect(types).toContain('text');
    expect(types[types.length - 1]).toBe('done');
    const done = events.find((e) => e.type === 'done') as {
      type: 'done';
      task: { status: string; steps: Array<{ status: string }> };
    };
    expect(done.task.status).toBe('completed');
    expect(done.task.steps[0]!.status).toBe('completed');
  });

  it('falls back to directResponse when plan is empty array', async () => {
    const adapter = sequencedAdapter(['[]', 'Direct answer']);
    let call = 0;
    adapter.chat = async function* () {
      call += 1;
      if (call === 1) {
        yield { type: 'text', content: '[]' };
      } else {
        yield { type: 'text', content: 'Direct answer' };
      }
      yield { type: 'done' };
    };
    const orch = new AgentOrchestrator(adapter, new ToolRegistry());
    const events = await collectEvents(orch.run('hi'));
    expect(events.map((e) => e.type)).toEqual(['plan', 'text', 'done']);
    expect((events[1] as { content: string }).content).toBe('Direct answer');
  });

  it('executes step with toolName+input without extra LLM tool selection', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: 'Echo',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      async execute(input) {
        return { success: true, output: { echoed: input.text } };
      },
    });

    let llmCalls = 0;
    const adapter = sequencedAdapter([]);
    adapter.chat = async function* () {
      llmCalls += 1;
      // only synthesize should call chat when plan is injected
      yield { type: 'text', content: 'done' };
      yield { type: 'done' };
    };

    const orch = new AgentOrchestrator(adapter, registry);
    injectPlan(orch, [
      step({
        description: 'Echo hi',
        toolName: 'echo',
        input: { text: 'hi' },
      }),
    ]);

    const events = await collectEvents(orch.run('echo'));
    expect(events.map((e) => e.type)).toEqual([
      'plan',
      'step_start',
      'step_complete',
      'text',
      'done',
    ]);
    expect(llmCalls).toBe(1); // synthesize only
  });

  it('retries a failed tool step and completes on second attempt', async () => {
    const registry = new ToolRegistry();
    let attempts = 0;
    registry.register({
      name: 'flaky',
      description: 'Flaky',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        attempts += 1;
        if (attempts === 1) {
          return { success: false, output: null, error: 'first fail' };
        }
        return { success: true, output: 'ok' };
      },
    });

    let llmCalls = 0;
    const adapter = sequencedAdapter([]);
    adapter.chat = async function* () {
      llmCalls += 1;
      yield { type: 'text', content: 'summary' };
      yield { type: 'done' };
    };

    const orch = new AgentOrchestrator(adapter, registry);
    injectPlan(orch, [
      step({ description: 'Run flaky', toolName: 'flaky', input: {} }),
    ]);

    const events = await collectEvents(orch.run('flaky goal'));
    const types = events.map((e) => e.type);
    expect(types).toContain('step_healing');
    expect(types).toContain('step_complete');
    expect(types[types.length - 1]).toBe('done');
    expect(attempts).toBe(2);
    expect(llmCalls).toBe(1); // synthesize only (retry reuses direct path)
  });

  it('aborts when reflection strategy returns abort', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'always_fail',
      description: 'Fail',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        return { success: false, output: null, error: 'hard fail' };
      },
    });

    let call = 0;
    const adapter = sequencedAdapter([]);
    adapter.chat = async function* () {
      call += 1;
      // retry fails again, then reflection chat
      yield { type: 'text', content: JSON.stringify({ action: 'abort' }) };
      yield { type: 'done' };
    };

    const orch = new AgentOrchestrator(adapter, registry);
    injectPlan(orch, [
      step({ description: 'Do thing', toolName: 'always_fail', input: {} }),
    ]);

    const events = await collectEvents(orch.run('abort path'));
    const types = events.map((e) => e.type);
    expect(types).toContain('step_healing');
    expect(types).toContain('error');
    expect(types).not.toContain('done');
    const err = events.find((e) => e.type === 'error') as { error: string };
    expect(err.error).toMatch(/aborted/i);
    expect(call).toBeGreaterThanOrEqual(1);
  });

  it('emits step_error and continues when healing cannot recover', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'bad',
      description: 'Bad',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        return { success: false, output: null, error: 'nope' };
      },
    });
    registry.register({
      name: 'good',
      description: 'Good',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        return { success: true, output: 'ok' };
      },
    });

    let call = 0;
    const adapter = sequencedAdapter([]);
    adapter.chat = async function* () {
      call += 1;
      // reflection responses for first step (retry already failed), then synthesize
      if (call === 1) {
        yield { type: 'text', content: JSON.stringify({ action: 'skip' }) };
      } else {
        yield { type: 'text', content: 'summary' };
      }
      yield { type: 'done' };
    };

    const orch = new AgentOrchestrator(adapter, registry);
    injectPlan(orch, [
      step({ description: 'Fail once', toolName: 'bad', input: {} }),
      step({ description: 'Then succeed', toolName: 'good', input: {} }),
    ]);

    const events = await collectEvents(orch.run('continue after error'));
    const types = events.map((e) => e.type);
    expect(types).toContain('step_error');
    expect(types).toContain('step_complete');
    expect(types[types.length - 1]).toBe('done');
  });

  it('stops with max iterations error when option is zero', async () => {
    const registry = new ToolRegistry();
    const adapter = sequencedAdapter([]);
    adapter.chat = async function* () {
      yield { type: 'done' };
    };

    const orch = new AgentOrchestrator(adapter, registry, { maxIterations: 0 });
    injectPlan(orch, [step({ description: 'Step A', type: 'plan' })]);

    const events = await collectEvents(orch.run('max'));
    expect(events.map((e) => e.type)).toEqual(['plan', 'error']);
    expect((events[1] as { error: string }).error).toMatch(/Max iterations/);
  });

  it('cancels during execution when signal aborts after plan', async () => {
    const registry = new ToolRegistry();
    const controller = new AbortController();
    const adapter = sequencedAdapter([]);
    adapter.chat = async function* () {
      yield { type: 'done' };
    };

    const orch = new AgentOrchestrator(adapter, registry);
    injectPlan(orch, [step({ description: 'Will cancel' })]);

    // Abort immediately after plan is yielded: injectPlan returns sync; abort before run loop continues
    // Use a plan that aborts via signal check at start of step loop
    controller.abort();
    // Re-run with aborted signal after plan would still hit "cancelled before planning" if aborted early.
    // Instead: use a custom plan that aborts mid-run by checking signal after plan.
    const orch2 = new AgentOrchestrator(adapter, registry);
    injectPlan(orch2, [step({ description: 'Will cancel' })]);
    const controller2 = new AbortController();
    // Abort after planning phase by patching plan to abort when called
    (orch2 as unknown as { planner: { plan: () => Promise<AgentStep[]> } }).planner = {
      plan: async () => {
        controller2.abort();
        return [step({ description: 'Will cancel' })];
      },
    };

    const events = await collectEvents(orch2.run('cancel mid', controller2.signal));
    expect(events.map((e) => e.type)).toEqual(['plan', 'error']);
    expect((events[1] as { error: string }).error).toMatch(/Cancelled during execution/);
  });

  it('heals via reflection revisedStep with new tool input', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'read',
      description: 'Read',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      async execute(input) {
        if (input.path === 'bad.txt') {
          return { success: false, output: null, error: 'missing' };
        }
        return { success: true, output: 'file contents' };
      },
    });

    let call = 0;
    const adapter = sequencedAdapter([]);
    adapter.chat = async function* () {
      call += 1;
      if (call === 1) {
        // reflection after retry also fails
        yield {
          type: 'text',
          content: JSON.stringify({
            action: 'retry',
            revisedDescription: 'Read good file',
            revisedToolName: 'read',
            revisedInput: { path: 'good.txt' },
          }),
        };
      } else {
        yield { type: 'text', content: 'summary' };
      }
      yield { type: 'done' };
    };

    const orch = new AgentOrchestrator(adapter, registry);
    injectPlan(orch, [
      step({
        description: 'Read bad',
        toolName: 'read',
        input: { path: 'bad.txt' },
      }),
    ]);

    const events = await collectEvents(orch.run('heal revise'));
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'step_healing')).toEqual(['step_healing', 'step_healing']);
    expect(types).toContain('step_complete');
    expect(types[types.length - 1]).toBe('done');
  });
});
