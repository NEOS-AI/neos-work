/**
 * Failure-path coverage for runWorker (orchestrator mocked to force terminal states).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DomainWorker } from '@neos-work/shared';

type Mode = 'failed' | 'cancelled' | 'pending' | 'throw_blank';
let mode: Mode = 'failed';

vi.mock('./orchestrator.js', () => {
  class AgentOrchestrator {
    static GOAL_MAX_CHARS = 100_000;
    constructor(..._args: unknown[]) {}
    async *run(_goal: string, _signal?: AbortSignal) {
      if (mode === 'throw_blank') {
        // Whitespace-only → scrubErrorMessage trims to '' → outer catch fallback
        throw new Error('   \n\t  ');
      }
      if (mode === 'failed') {
        yield {
          type: 'done' as const,
          task: { status: 'failed' as const, steps: [] },
        };
        return;
      }
      if (mode === 'cancelled') {
        yield {
          type: 'done' as const,
          task: { status: 'cancelled' as const, steps: [] },
        };
        return;
      }
      // Non-completed terminal without runError text path → secondary fail branch
      yield {
        type: 'done' as const,
        task: { status: 'pending' as const, steps: [] },
      };
    }
  }
  return { AgentOrchestrator };
});

import { runWorker } from './worker-runtime.js';

function makeWorker(partial: Partial<DomainWorker> & Pick<DomainWorker, 'id'>): DomainWorker {
  return {
    name: partial.name ?? partial.id,
    domain: partial.domain ?? 'general',
    description: partial.description ?? '',
    systemPrompt: partial.systemPrompt ?? 'You are a test worker.',
    ...partial,
  };
}

const stubAdapter = {
  id: 'openai' as const,
  name: 'Mock',
  getModels: () => [],
  async *chat() {
    yield { type: 'done' as const };
  },
  async validateApiKey() {
    return true;
  },
};

describe('runWorker failure terminals (mocked orchestrator)', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'neos-wr-fail-'));
    mode = 'failed';
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('fails when orchestrator reports task status failed without text', async () => {
    mode = 'failed';
    const events: string[] = [];
    const result = await runWorker({
      worker: makeWorker({
        id: 'fail_done',
        workspace: { kind: 'none' },
        permissionProfile: 'read_only',
      }),
      goal: 'do work',
      settings: {},
      adapter: stubAdapter,
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-fail-done' },
      onEvent: (e) => events.push(e.type),
    });
    expect(result.ok).toBe(false);
    expect(String(result.error ?? '')).toMatch(/failed|Worker/i);
    expect(events).toContain('worker.started');
    expect(events).toContain('worker.failed');
  });

  it('fails when orchestrator reports task status cancelled without text', async () => {
    mode = 'cancelled';
    const result = await runWorker({
      worker: makeWorker({
        id: 'cancel_done',
        workspace: { kind: 'none' },
        permissionProfile: 'read_only',
      }),
      goal: 'cancel me',
      settings: {},
      adapter: stubAdapter,
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-cancel' },
    });
    expect(result.ok).toBe(false);
    expect(String(result.error ?? '')).toMatch(/cancelled|Worker|failed/i);
  });

  it('fails closed when done status is neither completed nor failed/cancelled', async () => {
    mode = 'pending';
    const result = await runWorker({
      worker: makeWorker({
        id: 'pending_done',
        workspace: { kind: 'none' },
        permissionProfile: 'read_only',
      }),
      goal: 'odd terminal',
      settings: {},
      adapter: stubAdapter,
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-pending' },
    });
    expect(result.ok).toBe(false);
    expect(String(result.error ?? '')).toMatch(/Worker failed|failed/i);
  });

  it('falls back to Worker failed when orchestrator throws blank/whitespace error', async () => {
    mode = 'throw_blank';
    const result = await runWorker({
      worker: makeWorker({
        id: 'blank_throw',
        workspace: { kind: 'none' },
        permissionProfile: 'read_only',
      }),
      goal: 'blank',
      settings: {},
      adapter: stubAdapter,
      workspaceBaseDir: base,
      parent: { nodeId: 'n', runId: 'r-blank-throw' },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Worker failed');
  });
});
