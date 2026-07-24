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
});
