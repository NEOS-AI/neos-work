import { describe, expect, it } from 'vitest';
import type { ChatChunk, ChatParams } from '@neos-work/shared';
import { AgentOrchestrator } from './orchestrator.js';
import { ToolRegistry } from '../tools/registry.js';
import { mockAdapter } from '../test-utils/mock-adapter.js';
import type { LLMProviderAdapter } from '../llm/provider.js';

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
    expect(done.task.steps[0].status).toBe('completed');
  });

  it('falls back to directResponse when plan is empty array', async () => {
    // parseSteps returns [] only when JSON is array but not array after parse? 
    // Actually empty array [] is valid and returns [].
    const adapter = sequencedAdapter(['[]', 'Direct answer']);
    // First call plan returns [], second is directResponse
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
});
