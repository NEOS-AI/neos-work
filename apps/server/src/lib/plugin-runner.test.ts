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

  it('resumeRun rejects control-char / overlong ids and oversized response', () => {
    expect(resumeRun('bad\nid', 'stage', {})).toBe(false);
    expect(resumeRun('\nrun', 'stage', {})).toBe(false);
    expect(resumeRun('r'.repeat(101), 'stage', {})).toBe(false);
    const huge: Record<string, unknown> = {};
    for (let i = 0; i < 101; i++) huge[`k${i}`] = i;
    expect(resumeRun('run', 'stage', huge)).toBe(false);
    expect(resumeRun('run', 'stage', { blob: 'x'.repeat(300_000) })).toBe(false);
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

  it('caps oversized HITL resume payloads at 200 KiB', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'hitl-cap',
      name: 'HITL Cap',
      version: '0.0.1',
      pipeline: [
        {
          id: 'form1',
          name: 'Form',
          kind: 'form',
          humanInLoop: true,
          outputKey: 'answer',
          schema: { fields: [] },
        },
      ],
    };
    const events: Array<Record<string, unknown>> = [];
    let runId: string | null = null;
    const done = runPlugin({
      plugin,
      inputs: {},
      settings: {},
      onEvent: (e) => {
        events.push(e as unknown as Record<string, unknown>);
        if (e.type === 'pipeline.started') runId = e.runId;
        if (e.type === 'stage.waiting' && runId) {
          setTimeout(() => {
            expect(
              resumeRun(runId!, e.stageId, { blob: 'x'.repeat(250_000) }),
            ).toBe(true);
          }, 0);
        }
      },
    });
    await done;
    const completed = events.find((e) => e.type === 'stage.completed');
    const out = String(completed?.output ?? '');
    expect(out).toContain('…[truncated]');
    expect(out.length).toBeLessThanOrEqual(200_000 + 20);
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

  it('treats control-char or overlong API keys as missing', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'ctrl-keys',
      name: 'Ctrl Keys',
      version: '0.0.1',
      pipeline: [
        {
          id: 'plan',
          name: 'Plan',
          kind: 'plan',
          prompt: 'Do work',
          outputKey: 'plan',
        },
      ],
    };
    const events: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: {},
      settings: {
        ANTHROPIC_API_KEY: 'sk\nant',
        OPENAI_API_KEY: 'sk'.repeat(5_000),
      },
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    const completed = events.find((e) => e.type === 'stage.completed');
    expect(String(completed?.output ?? '')).toMatch(/No LLM API key/i);
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

  it('skips blank stage ids and trims stage name/outputKey', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'skip-blank',
      name: 'Skip Blank',
      version: '0.0.1',
      pipeline: [
        {
          id: '   ',
          name: 'Ignored',
          kind: 'plan',
          prompt: 'should not run',
          outputKey: 'ignored',
        },
        {
          id: '  plan  ',
          name: '  Plan Stage  ',
          kind: 'plan',
          prompt: 'Plan {{goal}}',
          outputKey: '  planOut  ',
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

    const started = events.filter((e) => e.type === 'stage.started');
    expect(started).toHaveLength(1);
    expect(started[0]?.stageId).toBe('plan');
    expect(started[0]?.stageName).toBe('Plan Stage');

    const completed = events.find((e) => e.type === 'pipeline.completed') as
      | { outputs?: Record<string, string> }
      | undefined;
    expect(completed?.outputs).toHaveProperty('planOut');
    expect(completed?.outputs).not.toHaveProperty('ignored');
  });

  it('defaults missing stage name/outputKey to stage id', async () => {
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'defaults',
      name: 'Defaults',
      version: '0.0.1',
      pipeline: [
        {
          id: 'only',
          kind: 'plan',
          prompt: 'x',
        } as PluginManifest['pipeline'] extends (infer S)[] | undefined ? S : never,
      ],
    };
    const events: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: {},
      settings: {},
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    });
    const started = events.find((e) => e.type === 'stage.started');
    expect(started?.stageId).toBe('only');
    expect(started?.stageName).toBe('only');
    const completed = events.find((e) => e.type === 'pipeline.completed') as
      | { outputs?: Record<string, string> }
      | undefined;
    expect(completed?.outputs).toHaveProperty('only');
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

  it('truncates oversized stage prompts/outputs and skips unsafe placeholder keys', async () => {
    const STAGE_PROMPT_MAX = 100_000;
    const STAGE_OUTPUT_MAX = 200_000;
    const plugin: PluginManifest = {
      schemaVersion: 'od-plugin/v1',
      id: 'caps',
      name: 'Caps',
      version: '0.0.1',
      pipeline: [
        {
          id: 'plan',
          name: 'Plan',
          kind: 'plan',
          // dotted key is unsafe and must not interpolate
          prompt: 'PRE{{evil.key}}{{blob}}',
          outputKey: 'plan',
        },
      ],
    };
    // Keep prefix + unsubbed placeholder visible, then overflow with blob
    const blob = 'B'.repeat(STAGE_PROMPT_MAX);
    const hugeOut = 'O'.repeat(STAGE_OUTPUT_MAX + 50);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: hugeOut }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const events: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: { blob, 'evil.key': 'SHOULD_NOT_APPEAR' },
      settings: { ANTHROPIC_API_KEY: 'sk-ant' },
      onEvent: (e) => events.push(e as unknown as Record<string, unknown>),
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
      messages: Array<{ content: string }>;
    };
    const promptSent = body.messages[0]?.content ?? '';
    expect(promptSent.startsWith('PRE{{evil.key}}')).toBe(true);
    expect(promptSent).not.toContain('SHOULD_NOT_APPEAR');
    expect(promptSent).toContain('…[prompt truncated]');
    expect(promptSent.length).toBeLessThanOrEqual(STAGE_PROMPT_MAX + 30);

    const out = String(events.find((e) => e.type === 'stage.completed')?.output ?? '');
    expect(out).toContain('…[output truncated]');
    expect(out.length).toBeLessThanOrEqual(STAGE_OUTPUT_MAX + 30);
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
      vi.fn().mockResolvedValue({
        ok: false,
        status: 529,
        text: async () => '  overloaded  ',
        json: async () => ({}),
      }),
    );
    const anthroEvents: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: {},
      settings: { ANTHROPIC_API_KEY: 'sk-ant' },
      onEvent: (e) => anthroEvents.push(e as unknown as Record<string, unknown>),
    });
    const anthroOut = String(anthroEvents.find((e) => e.type === 'stage.completed')?.output ?? '');
    expect(anthroOut).toMatch(/Anthropic API error 529/i);
    expect(anthroOut).toContain('overloaded');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => '  unavailable  ',
        json: async () => ({}),
      }),
    );
    const oaiEvents: Array<Record<string, unknown>> = [];
    await runPlugin({
      plugin,
      inputs: {},
      settings: { OPENAI_API_KEY: 'sk-oai' },
      onEvent: (e) => oaiEvents.push(e as unknown as Record<string, unknown>),
    });
    const oaiOut = String(oaiEvents.find((e) => e.type === 'stage.completed')?.output ?? '');
    expect(oaiOut).toMatch(/OpenAI API error 503/i);
    expect(oaiOut).toContain('unavailable');
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

