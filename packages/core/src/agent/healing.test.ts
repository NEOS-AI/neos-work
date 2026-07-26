import { describe, expect, it, vi } from 'vitest';
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
    // No closing brace → regex miss → skip without parse
    const noClose = await new ReflectionStrategy(mockAdapter(['{not-json'])).heal(step, 'e', []);
    expect(noClose.action).toBe('skip');

    // Closing brace present but invalid JSON → parse throws → catch skip
    const badJson = await new ReflectionStrategy(
      mockAdapter(['here {not valid json} end']),
    ).heal(step, 'e', []);
    expect(badJson.action).toBe('skip');
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

  it('drops unsafe revised tool names and caps revised description', async () => {
    const result = await new ReflectionStrategy(
      mockAdapter([
        JSON.stringify({
          action: 'retry',
          revisedDescription: 'd'.repeat(3_000),
          revisedToolName: 'bad\ntool',
          revisedInput: { path: '.' },
        }),
      ]),
    ).heal(step, 'e', []);
    expect(result.action).toBe('retry');
    expect(result.revisedStep?.description?.length).toBe(2_000);
    expect(result.revisedStep?.toolName).toBe(step.toolName);
    expect(result.revisedStep?.input).toEqual({ path: '.' });
  });

  it('extracts JSON object from surrounding prose', async () => {
    const result = await new ReflectionStrategy(
      mockAdapter([
        'Here is my recommendation:\n```json\n{"action":"abort"}\n```\nGood luck.',
      ]),
    ).heal(step, 'fatal', [step]);
    expect(result.action).toBe('abort');
  });

  it('scrubs control characters from the current error in the reflection prompt', async () => {
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
    await new ReflectionStrategy(adapter).heal(step, `line1\nline2${'\0'}x`, []);
    const errorLine = captured.split('\n').find((l) => l.startsWith('에러:')) ?? '';
    expect(errorLine).toContain('line1');
    expect(errorLine).toContain('line2');
    // Control chars scrubbed to spaces within the error line
    expect(errorLine).not.toMatch(/[\r\n\0]/);
    expect(errorLine).toBe('에러: line1 line2 x');
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

  it('treats control-char actions as skip and drops null-byte revisedDescription', async () => {
    const badAction = await new ReflectionStrategy(
      mockAdapter([JSON.stringify({ action: 'retry\n' })]),
    ).heal(step, 'e', []);
    expect(badAction.action).toBe('skip');
    expect(badAction.revisedStep).toBeUndefined();

    const nullDesc = await new ReflectionStrategy(
      mockAdapter([
        JSON.stringify({
          action: 'retry',
          revisedDescription: `fixed${'\0'}path`,
          revisedToolName: 'read_file',
        }),
      ]),
    ).heal(step, 'e', []);
    expect(nullDesc.action).toBe('retry');
    // Null-byte description dropped → fall back to original
    expect(nullDesc.revisedStep?.description).toBe(step.description);
    expect(nullDesc.revisedStep?.toolName).toBe('read_file');
  });

  it('drops overlong revised tool names and truncates oversized revisedInput', async () => {
    const longTool = await new ReflectionStrategy(
      mockAdapter([
        JSON.stringify({
          action: 'retry',
          revisedToolName: 't'.repeat(101),
          revisedInput: { path: 'ok' },
        }),
      ]),
    ).heal(step, 'e', []);
    expect(longTool.action).toBe('retry');
    expect(longTool.revisedStep?.toolName).toBe(step.toolName);
    expect(longTool.revisedStep?.input).toEqual({ path: 'ok' });

    const fatInput = await new ReflectionStrategy(
      mockAdapter([
        JSON.stringify({
          action: 'retry',
          revisedInput: { blob: 'x'.repeat(20_000) },
        }),
      ]),
    ).heal(step, 'e', []);
    expect(fatInput.action).toBe('retry');
    expect(fatInput.revisedStep?.input).toEqual({
      _truncated: true,
      note: 'revisedInput exceeded 16k',
    });
  });

  it('omits input section when step has no input and coerces non-string errors', async () => {
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
    const bare: AgentStep = {
      id: 'bare',
      index: 0,
      description: 'No input step',
      type: 'plan',
      status: 'error',
    };
    await new ReflectionStrategy(adapter).heal(bare, { code: 42 } as unknown as string, []);
    expect(captured).toContain('목표: No input step');
    expect(captured).not.toMatch(/^입력:/m);
    expect(captured).toMatch(/에러:.*\[object Object\]|에러:.*code/i);
  });

  it('falls back to original input when revisedInput is an array', async () => {
    const result = await new ReflectionStrategy(
      mockAdapter([
        JSON.stringify({
          action: 'retry',
          revisedInput: ['not', 'an', 'object'],
        }),
      ]),
    ).heal(step, 'e', []);
    expect(result.action).toBe('retry');
    expect(result.revisedStep?.input).toEqual(step.input);
  });

  it('handles history without errors, missing description, empty models, null error', async () => {
    let captured = '';
    const adapter = {
      id: 'openai' as const,
      name: 'Cap',
      getModels: () => [] as Array<{ id: string }>,
      async *chat(params: { messages?: Array<{ content?: string }>; model?: string }) {
        captured = String(params.messages?.[0]?.content ?? '');
        // empty models → model id falls back to ''
        expect(params.model ?? '').toBe('');
        yield { type: 'text' as const, content: JSON.stringify({ action: 'skip' }) };
        yield { type: 'done' as const };
      },
      async validateApiKey() {
        return true;
      },
    };
    const history: AgentStep[] = [
      {
        id: 'ok',
        index: 0,
        description: 'Completed fine',
        type: 'tool_use',
        status: 'completed',
        // no error field → history branch without "(에러: …)"
      },
      {
        id: 'bare-hist',
        index: 1,
        description: undefined as unknown as string,
        type: 'tool_use',
        status: 'error',
        error: 'hist-err',
      },
    ];
    const noDesc: AgentStep = {
      id: 'nd',
      index: 2,
      description: undefined as unknown as string,
      type: 'plan',
      status: 'error',
    };
    await new ReflectionStrategy(adapter as never).heal(
      noDesc,
      null as unknown as string,
      history,
    );
    expect(captured).toContain('목표:');
    expect(captured).toContain('[completed] Completed fine');
    expect(captured).not.toMatch(/Completed fine \(에러:/);
    expect(captured).toContain('hist-err');
  });

  it('drops revisedInput when JSON.stringify throws (non-serializable payload)', async () => {
    // Build LLM payload before installing the spy
    const llmPayload = JSON.stringify({
      action: 'retry',
      revisedInput: { boom: true },
    });
    const origStringify = JSON.stringify.bind(JSON);
    const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation(((
      value: unknown,
      ...rest: unknown[]
    ) => {
      if (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && value !== null
        && 'boom' in (value as object)
      ) {
        throw new TypeError('Cannot serialize');
      }
      return (origStringify as (...args: unknown[]) => string)(value, ...rest);
    }) as typeof JSON.stringify);
    try {
      const result = await new ReflectionStrategy(mockAdapter([llmPayload])).heal(step, 'e', []);
      expect(result.action).toBe('retry');
      // stringify failure → input undefined → fall back to original step.input
      expect(result.revisedStep?.input).toEqual(step.input);
    } finally {
      stringifySpy.mockRestore();
    }
  });
});
