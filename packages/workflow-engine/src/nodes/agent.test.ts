import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const orchestratorCtor = vi.fn();
const orchestratorRun = vi.fn(async function* () {
  yield { type: 'done', task: { steps: [] } };
});

vi.mock('@neos-work/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neos-work/core')>();
  return {
    ...actual,
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

describe('AgentNode CLI provider', () => {
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
});

describe('AgentNode LLM model selection', () => {
  beforeEach(() => {
    orchestratorCtor.mockClear();
    orchestratorRun.mockReset();
    orchestratorRun.mockImplementation(async function* () {
      yield { type: 'done', task: { steps: [] } };
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
});

