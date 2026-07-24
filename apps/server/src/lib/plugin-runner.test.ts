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

describe('plugin-runner resume / abort / LLM paths', () => {
  it('resumeRun returns false on stage mismatch', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'mismatch',
      name: 'Mismatch',
      version: '0.0.1',
      pipeline: [
        {
          id: 'confirm',
          name: 'Confirm',
          kind: 'form',
          humanInLoop: true,
          outputKey: 'answer',
        },
      ],
    };
    let runId: string | null = null;
    let resumedWrong = false;
    const done = runPlugin({
      plugin,
      inputs: {},
      settings: {},
      onEvent: (e) => {
        if (e.type === 'pipeline.started') runId = e.runId;
        if (e.type === 'stage.waiting' && runId) {
          setTimeout(() => {
            resumedWrong = resumeRun(runId!, 'wrong-stage', {});
            // correct stage so the pipeline can finish
            resumeRun(runId!, e.stageId, { ok: true });
          }, 0);
        }
      },
    });
    await done;
    expect(resumedWrong).toBe(false);
  });

  it('aborts human-in-loop wait when signal fires', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'abort-wait',
      name: 'Abort Wait',
      version: '0.0.1',
      pipeline: [
        {
          id: 'confirm',
          name: 'Confirm',
          kind: 'form',
          humanInLoop: true,
          outputKey: 'answer',
        },
      ],
    };
    const controller = new AbortController();
    const events: Array<{ type: string; error?: string }> = [];
    const done = runPlugin({
      plugin,
      inputs: {},
      settings: {},
      signal: controller.signal,
      onEvent: (e) => {
        events.push(e as { type: string; error?: string });
        if (e.type === 'stage.waiting') {
          setTimeout(() => controller.abort(), 0);
        }
      },
    });
    await done;
    expect(events.some((e) => e.type === 'pipeline.failed')).toBe(true);
    const failed = events.find((e) => e.type === 'pipeline.failed');
    expect(String(failed?.error ?? '')).toMatch(/Abort/i);
  });

  it('uses Anthropic success path and interpolates prompt placeholders', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'anthro-ok',
      name: 'Anthro Ok',
      version: '0.0.1',
      pipeline: [
        {
          id: 'plan',
          name: 'Plan',
          kind: 'plan',
          prompt: 'Plan for {{goal}} using {{prior}}',
          outputKey: 'plan',
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'anthro-plan' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const events: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: { goal: 'launch', prior: 'notes' },
      settings: { ANTHROPIC_API_KEY: 'sk-ant' },
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    const completed = events.find((e) => e.type === 'stage.completed');
    expect(String(completed?.output ?? '')).toBe('anthro-plan');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0]?.content).toContain('launch');
    expect(body.messages[0]?.content).toContain('notes');
    expect(String(fetchMock.mock.calls[0]?.[0] ?? '')).toContain('api.anthropic.com');
  });

  it('surfaces Anthropic and OpenAI HTTP error statuses', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'llm-http-err',
      name: 'LLM HTTP',
      version: '0.0.1',
      pipeline: [
        { id: 'plan', name: 'Plan', kind: 'plan', prompt: 'x', outputKey: 'plan' },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 529, json: async () => ({}) }),
    );
    const anthroEvents: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: {},
      settings: { ANTHROPIC_API_KEY: 'sk-ant' },
      onEvent: (e) => anthroEvents.push(e as unknown as Record<string, unknown>),
    });
    expect(String(anthroEvents.find((e) => e.type === 'stage.completed')?.output ?? '')).toMatch(
      /Anthropic API error 529/i,
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );
    const oaiEvents: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: {},
      settings: { OPENAI_API_KEY: 'sk-oai' },
      onEvent: (e) => oaiEvents.push(e as unknown as Record<string, unknown>),
    });
    expect(String(oaiEvents.find((e) => e.type === 'stage.completed')?.output ?? '')).toMatch(
      /OpenAI API error 503/i,
    );
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

