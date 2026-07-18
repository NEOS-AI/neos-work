import { describe, expect, it, vi, beforeEach } from 'vitest';

const orchestratorCtor = vi.fn();
vi.mock('@neos-work/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neos-work/core')>();
  return {
    ...actual,
    AgentOrchestrator: class {
      constructor(...args: unknown[]) {
        orchestratorCtor(...args);
      }
      async *run() {
        yield { type: 'done', task: { steps: [] } };
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
});

