import { afterEach, describe, expect, it, vi } from 'vitest';
import { resumeRun, runPlugin } from './plugin-runner.js';
import type { PluginManifest } from './plugin-store.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('plugin-runner', () => {
  it('resumeRun returns false for unknown run', () => {
    expect(resumeRun('no-run', 'stage', {})).toBe(false);
    expect(resumeRun('  ', 'stage', {})).toBe(false);
    expect(resumeRun('run', '  ', {})).toBe(false);
  });

  it('runs human-only pipeline with resume', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'human-only',
      name: 'Human Only',
      version: '0.0.1',
      pipeline: [
        {
          id: 'confirm',
          name: 'Confirm',
          kind: 'form',
          humanInLoop: true,
          outputKey: 'answer',
          schema: { fields: [] },
        },
      ],
    };

    const events: Array<{ type: string }> = [];
    let runId: string | null = null;

    const done = runPlugin({
      plugin,
      inputs: { goal: 'x' },
      settings: {},
      onEvent: (e) => {
        events.push(e);
        if (e.type === 'pipeline.started') runId = e.runId;
        if (e.type === 'stage.waiting' && runId) {
          // resume asynchronously
          setTimeout(() => {
            expect(resumeRun(runId!, e.stageId, { confirmed: true })).toBe(true);
          }, 0);
        }
      },
    });

    const id = await done;
    expect(id).toBeTruthy();
    expect(events.some((e) => e.type === 'stage.waiting')).toBe(true);
    expect(events.some((e) => e.type === 'pipeline.completed')).toBe(true);
  });

  it('returns placeholder when no API key for LLM stage', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'llm-stage',
      name: 'LLM Stage',
      version: '0.0.1',
      pipeline: [
        {
          id: 'plan',
          name: 'Plan',
          kind: 'plan',
          prompt: 'Plan {{goal}}',
          outputKey: 'plan',
        },
      ],
    };
    const events: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: { goal: 'ship' },
      settings: {},
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    const completed = events.find((e) => e.type === 'stage.completed');
    expect(String(completed?.output ?? '')).toMatch(/No LLM API key/i);
    expect(events.some((e) => e.type === 'pipeline.completed')).toBe(true);
  });

  it('falls back when stage prompt is blank/whitespace', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'blank-prompt',
      name: 'Blank Prompt',
      version: '0.0.1',
      pipeline: [
        {
          id: 'plan',
          name: '  Plan Stage  ',
          kind: 'plan',
          prompt: '   ',
          outputKey: 'plan',
        },
      ],
    };
    const events: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: {},
      settings: {},
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    const completed = events.find((e) => e.type === 'stage.completed');
    // Still completes with no-key placeholder; stage name is trimmed in message
    expect(String(completed?.output ?? '')).toMatch(/No LLM API key/i);
    expect(String(completed?.output ?? '')).toMatch(/Plan Stage/);
  });

  it('treats whitespace-only API keys as missing', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'llm-ws',
      name: 'LLM WS',
      version: '0.0.1',
      pipeline: [
        {
          id: 'plan',
          name: 'Plan',
          kind: 'plan',
          prompt: 'Plan {{goal}}',
          outputKey: 'plan',
        },
      ],
    };
    const events: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: { goal: 'ship' },
      settings: { ANTHROPIC_API_KEY: '   ', OPENAI_API_KEY: '  ' },
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    const completed = events.find((e) => e.type === 'stage.completed');
    expect(String(completed?.output ?? '')).toMatch(/No LLM API key/i);
  });

  it('surfaces network failures for LLM stage without throwing', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'llm-net',
      name: 'LLM Net',
      version: '0.0.1',
      pipeline: [
        {
          id: 'plan',
          name: 'Plan',
          kind: 'plan',
          prompt: 'Plan {{goal}}',
          outputKey: 'plan',
        },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const events: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: { goal: 'ship' },
      settings: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    vi.unstubAllGlobals();
    const completed = events.find((e) => e.type === 'stage.completed');
    expect(String(completed?.output ?? '')).toMatch(/network down/i);
    expect(events.some((e) => e.type === 'pipeline.completed')).toBe(true);
  });

  it('falls through whitespace Anthropic key to OpenAI', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'llm-fallback',
      name: 'LLM Fallback',
      version: '0.0.1',
      pipeline: [
        {
          id: 'plan',
          name: 'Plan',
          kind: 'plan',
          prompt: 'Plan {{goal}}',
          outputKey: 'plan',
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'openai-ok' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const events: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: { goal: 'ship' },
      settings: { ANTHROPIC_API_KEY: '   ', OPENAI_API_KEY: 'sk-openai' },
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    const completed = events.find((e) => e.type === 'stage.completed');
    expect(String(completed?.output ?? '')).toBe('openai-ok');
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain('api.openai.com');
  });
});

describe('plugin-runner empty pipeline', () => {
  it('completes immediately when pipeline is empty', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'empty',
      name: 'Empty',
      version: '0.0.1',
      pipeline: [],
    };
    const events: Array<{ type: string }> = [];
    await runPlugin({
      plugin,
      inputs: {},
      settings: {},
      onEvent: (e) => events.push(e),
    });
    expect(events.some((e) => e.type === 'pipeline.started')).toBe(true);
    expect(events.some((e) => e.type === 'pipeline.completed')).toBe(true);
  });
});

describe('plugin-runner multi-stage human-in-loop', () => {
  it('waits twice for form then confirmation', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'two-wait',
      name: 'Two Wait',
      version: '0.0.1',
      pipeline: [
        {
          id: 'form',
          name: 'Form',
          kind: 'form',
          humanInLoop: true,
          outputKey: 'formOut',
          schema: { fields: [] },
        },
        {
          id: 'confirm',
          name: 'Confirm',
          kind: 'form',
          humanInLoop: true,
          outputKey: 'confirmOut',
        },
      ],
    };
    const events: Array<{ type: string; stageId?: string }> = [];
    let runId: string | null = null;
    let waitCount = 0;

    const done = runPlugin({
      plugin,
      inputs: {},
      settings: {},
      onEvent: (e) => {
        events.push(e as { type: string; stageId?: string });
        if (e.type === 'pipeline.started') runId = e.runId;
        if (e.type === 'stage.waiting' && runId) {
          waitCount += 1;
          const response = waitCount === 1 ? { name: 'Ada' } : { confirmed: true };
          setTimeout(() => {
            expect(resumeRun(runId!, e.stageId, response)).toBe(true);
          }, 0);
        }
      },
    });

    await done;
    expect(waitCount).toBe(2);
    expect(events.filter((e) => e.type === 'stage.waiting')).toHaveLength(2);
    expect(events.some((e) => e.type === 'pipeline.completed')).toBe(true);
  });
});

