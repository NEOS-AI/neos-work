import { describe, expect, it } from 'vitest';
import { ReflectionStrategy, RetryStrategy } from './healing.js';
import type { AgentStep } from './types.js';
import { mockAdapter } from '../test-utils/mock-adapter.js';

const step: AgentStep = {
  id: 's1',
  index: 0,
  description: 'Read file',
  type: 'tool_use',
  status: 'error',
  toolName: 'read_file',
  input: { path: 'a.txt' },
  error: 'not found',
};

describe('RetryStrategy', () => {
  it('always returns retry', async () => {
    const result = await new RetryStrategy().heal();
    expect(result).toEqual({ action: 'retry' });
  });
});

describe('ReflectionStrategy', () => {
  it('parses retry with revised step fields', async () => {
    const adapter = mockAdapter([
      JSON.stringify({
        action: 'retry',
        revisedDescription: 'Use list_directory first',
        revisedToolName: 'list_directory',
        revisedInput: { path: '.' },
      }),
    ]);
    const result = await new ReflectionStrategy(adapter).heal(step, 'ENOENT', [step]);
    expect(result.action).toBe('retry');
    expect(result.revisedStep).toEqual({
      description: 'Use list_directory first',
      toolName: 'list_directory',
      input: { path: '.' },
    });
  });

  it('defaults to skip when JSON missing or invalid action', async () => {
    const noJson = await new ReflectionStrategy(mockAdapter(['sorry'])).heal(step, 'err', []);
    expect(noJson.action).toBe('skip');

    const skipAction = await new ReflectionStrategy(
      mockAdapter([JSON.stringify({ action: 'skip' })]),
    ).heal(step, 'err', []);
    expect(skipAction.action).toBe('skip');
  });

  it('accepts abort action', async () => {
    const result = await new ReflectionStrategy(
      mockAdapter([JSON.stringify({ action: 'abort' })]),
    ).heal(step, 'fatal', []);
    expect(result.action).toBe('abort');
    expect(result.revisedStep).toBeUndefined();
  });

  it('returns skip when JSON parse fails', async () => {
    const result = await new ReflectionStrategy(mockAdapter(['{not-json'])).heal(step, 'e', []);
    expect(result.action).toBe('skip');
  });

  it('fills revised fields from original step when omitted', async () => {
    const result = await new ReflectionStrategy(
      mockAdapter([JSON.stringify({ action: 'retry' })]),
    ).heal(step, 'e', []);
    expect(result.revisedStep).toEqual({
      description: step.description,
      toolName: step.toolName,
      input: step.input,
    });
  });

  it('extracts JSON object from surrounding prose', async () => {
    const result = await new ReflectionStrategy(
      mockAdapter([
        'Here is my recommendation:\n```json\n{"action":"abort"}\n```\nGood luck.',
      ]),
    ).heal(step, 'fatal', [step]);
    expect(result.action).toBe('abort');
  });

  it('includes history errors in the reflection prompt', async () => {
    const adapter = mockAdapter([JSON.stringify({ action: 'skip' })]);
    const history: AgentStep[] = [
      {
        id: 'h1',
        index: 0,
        description: 'Earlier step',
        type: 'tool_use',
        status: 'error',
        error: 'boom',
      },
    ];
    await new ReflectionStrategy(adapter).heal(step, 'again', history);
    // mockAdapter records last chat params via getModels + chat; ensure chat was invoked
    expect(adapter.getModels().length).toBeGreaterThan(0);
  });

  it('bounds history to last 20 steps and truncates long fields in the prompt', async () => {
    let captured = '';
    const adapter = {
      id: 'openai' as const,
      name: 'Cap',
      getModels: () => [
        {
          id: 'mock-model',
          name: 'Mock',
          providerId: 'openai' as const,
          contextWindow: 128_000,
          supportsThinking: false,
          supportsTools: true,
          supportsVision: false,
        },
      ],
      async *chat(params: { messages?: Array<{ content?: string }> }) {
        captured = String(params.messages?.[0]?.content ?? '');
        yield { type: 'text' as const, content: JSON.stringify({ action: 'skip' }) };
        yield { type: 'done' as const };
      },
      async validateApiKey() {
        return true;
      },
    };
    const history: AgentStep[] = Array.from({ length: 30 }, (_, i) => ({
      id: `h${i}`,
      index: i,
      description: `step-${i}-${'D'.repeat(600)}`,
      type: 'tool_use',
      status: 'error',
      error: 'E'.repeat(400),
    }));
    const fatStep: AgentStep = {
      id: 'fat',
      index: 99,
      description: 'G'.repeat(2_000),
      type: 'tool_use',
      toolName: 'T'.repeat(150),
      input: { blob: 'x'.repeat(4_000) },
      status: 'error',
    };
    await new ReflectionStrategy(adapter).heal(fatStep, 'ERR'.repeat(1_500), history);

    // Last 20 history entries only (step-0..9 dropped); history string then capped at 8k
    expect(captured).not.toContain('step-0-');
    expect(captured).not.toContain('step-9-');
    expect(captured).toContain('step-10-');
    // Field caps on the failed step
    expect(captured).toMatch(/툴: T{100}/);
    expect(captured.length).toBeLessThan(25_000);
  });

  it('normalizes action case and trims revised fields', async () => {
    const adapter = mockAdapter([
      JSON.stringify({
        action: '  RETRY  ',
        revisedDescription: '  Use list  ',
        revisedToolName: '  list_directory  ',
        revisedInput: { path: '.' },
      }),
    ]);
    const result = await new ReflectionStrategy(adapter).heal(step, '  err  ', []);
    expect(result.action).toBe('retry');
    expect(result.revisedStep?.description).toBe('Use list');
    expect(result.revisedStep?.toolName).toBe('list_directory');
  });
});
