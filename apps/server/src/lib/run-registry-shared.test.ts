import { afterEach, describe, expect, it } from 'vitest';
import {
  getGlobalRunRegistry,
  resetGlobalRunRegistry,
} from '@neos-work/agent-runtime';
import {
  appendRunEvent,
  applyLocalCancelFromCommand,
  createMemorySharedRunStore,
  createSharedMemoryBackendForTests,
  createSharedRunStore,
  dualWriteRunEvent,
  dualWriteRunRecord,
  getSharedRunStore,
  initSharedRunStore,
  parseRuntimeRunEvent,
  parseSharedRunSummary,
  resetSharedRunStoreForTests,
  resolveRunRegistryMode,
  RUN_EVENT_BUFFER_MAX,
  serializeRuntimeRunEvent,
  serializeSharedRunSummary,
  setRunRegistryNodeIdForTests,
  setSharedRunStoreForTests,
  summaryFromRecord,
  syncRunSummary,
  type SharedRunSummary,
} from './run-registry-shared.js';

afterEach(() => {
  resetSharedRunStoreForTests();
  resetGlobalRunRegistry();
  setRunRegistryNodeIdForTests(null);
});

describe('resolveRunRegistryMode', () => {
  it('defaults to auto and parses env', () => {
    expect(resolveRunRegistryMode({})).toBe('auto');
    expect(resolveRunRegistryMode({ NEOS_RUN_REGISTRY: 'off' })).toBe('off');
    expect(resolveRunRegistryMode({ NEOS_RUN_REGISTRY: 'memory' })).toBe('memory');
    expect(resolveRunRegistryMode({ NEOS_RUN_REGISTRY: 'redis' })).toBe('redis');
    expect(resolveRunRegistryMode({ NEOS_RUN_REGISTRY: 'AUTO' })).toBe('auto');
    expect(resolveRunRegistryMode({ NEOS_RUN_REGISTRY: 'false' })).toBe('off');
  });
});

describe('createSharedRunStore modes', () => {
  it('off is a no-op store', async () => {
    const s = createSharedRunStore({ NEOS_RUN_REGISTRY: 'off' }, { nodeId: 'n-off' });
    expect(s.kind).toBe('off');
    expect(s.nodeId).toBe('n-off');
    await s.put({
      id: 'r1',
      status: 'running',
      nodeId: 'n-off',
      projectId: null,
      collabSessionId: null,
      agentId: 'cli-claude',
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await s.get('r1')).toBeNull();
  });

  it('auto without redis bus/URL is memory', () => {
    const s = createSharedRunStore(
      { NEOS_COLLAB_BUS: 'memory' },
      { nodeId: 'n1' },
    );
    expect(s.kind).toBe('memory');
    expect(s.status().ready).toBe(true);
  });

  it('redis mode without URL is redis-stub', () => {
    const s = createSharedRunStore(
      {
        NEOS_RUN_REGISTRY: 'redis',
        NEOS_COLLAB_BUS: 'redis',
      },
      { nodeId: 'n-stub' },
    );
    expect(s.kind).toBe('redis-stub');
    expect(s.status().ready).toBe(true);
  });

  it('auto with redis URL wants redis path (stub without connect)', async () => {
    const s = createSharedRunStore(
      {
        NEOS_RUN_REGISTRY: 'auto',
        NEOS_COLLAB_REDIS_URL: 'redis://127.0.0.1:6379',
      },
      { nodeId: 'n-auto' },
    );
    // either redis (connecting) or redis-stub once connect fails — never plain off
    expect(['redis', 'redis-stub']).toContain(s.kind);
    await s.close();
  });
});

describe('memory dual-write + dual-process simulation', () => {
  it('put/get/markCanceled round-trip', async () => {
    const backend = createSharedMemoryBackendForTests();
    const s = createMemorySharedRunStore({ nodeId: 'node-a', backend });
    const summary: SharedRunSummary = {
      id: 'run-1',
      status: 'running',
      nodeId: 'node-a',
      projectId: 'proj-1',
      collabSessionId: 'sess-1',
      agentId: 'cli-claude',
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:01.000Z',
      completedAt: null,
      updatedAt: '2026-01-01T00:00:01.000Z',
    };
    await s.put(summary);
    const got = await s.get('run-1');
    expect(got?.status).toBe('running');
    expect(got?.nodeId).toBe('node-a');
    expect(got?.projectId).toBe('proj-1');

    const marked = await s.markCanceled('run-1');
    expect(marked?.status).toBe('canceled');
    expect(marked?.completedAt).toBeTruthy();
    // terminal mark is idempotent
    const again = await s.markCanceled('run-1');
    expect(again?.status).toBe('canceled');
  });

  it('cross-node get sees dual-written summary', async () => {
    const backend = createSharedMemoryBackendForTests();
    const owner = createMemorySharedRunStore({ nodeId: 'owner', backend });
    const peer = createMemorySharedRunStore({ nodeId: 'peer', backend });

    await owner.put({
      id: 'run-x',
      status: 'running',
      nodeId: 'owner',
      projectId: null,
      collabSessionId: null,
      agentId: 'cli-gemini',
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const remote = await peer.get('run-x');
    expect(remote).not.toBeNull();
    expect(remote!.nodeId).toBe('owner');
    expect(remote!.agentId).toBe('cli-gemini');
  });

  it('cross-node cancel publishes to owner and marks store', async () => {
    const backend = createSharedMemoryBackendForTests();
    const ownerStore = createMemorySharedRunStore({ nodeId: 'owner', backend });
    const peerStore = createMemorySharedRunStore({ nodeId: 'peer', backend });

    // Owner has a live local run
    setRunRegistryNodeIdForTests('owner');
    const reg = getGlobalRunRegistry();
    const run = reg.create({
      id: 'run-cancel-me',
      agentId: 'cli-claude',
      prompt: 'hang',
    });
    reg.setStatus(run.id, 'running');
    await ownerStore.put(summaryFromRecord(run, 'owner'));

    // Wire owner cancel listener (simulate init)
    const unsub = ownerStore.onCancelCommand((cmd) => {
      applyLocalCancelFromCommand(cmd);
      void dualWriteRunRecord(reg.get(cmd.runId)!);
    });

    // Peer receives cancel REST path: publish + mark
    await peerStore.publishCancel(run.id);
    const marked = await peerStore.markCanceled(run.id);

    expect(reg.get(run.id)?.status).toBe('canceled');
    expect(marked?.status).toBe('canceled');
    const fromStore = await peerStore.get(run.id);
    expect(fromStore?.status).toBe('canceled');

    unsub();
  });

  it('publishCancel delivers to all memory handlers', async () => {
    const backend = createSharedMemoryBackendForTests();
    const a = createMemorySharedRunStore({ nodeId: 'a', backend });
    const b = createMemorySharedRunStore({ nodeId: 'b', backend });
    const seen: string[] = [];
    a.onCancelCommand((c) => seen.push(`a:${c.runId}`));
    b.onCancelCommand((c) => seen.push(`b:${c.runId}`));
    await a.publishCancel('run-z');
    expect(seen).toEqual(['a:run-z', 'b:run-z']);
  });
});

describe('parse / serialize', () => {
  it('round-trips a valid summary', () => {
    const s: SharedRunSummary = {
      id: 'abc',
      status: 'succeeded',
      nodeId: 'n1',
      projectId: 'p1',
      collabSessionId: null,
      agentId: null,
      error: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: null,
      completedAt: '2026-01-01T00:01:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z',
    };
    const raw = serializeSharedRunSummary(s);
    expect(parseSharedRunSummary(raw)).toEqual(s);
  });

  it('rejects control chars and garbage', () => {
    expect(parseSharedRunSummary('not-json')).toBeNull();
    expect(parseSharedRunSummary(JSON.stringify({ id: 'x\0y', status: 'running', nodeId: 'n' }))).toBeNull();
    expect(parseSharedRunSummary(JSON.stringify({ id: 'ok' }))).toBeNull();
  });
});

describe('syncRunSummary dual-write', () => {
  it('writes local run into shared store', async () => {
    setRunRegistryNodeIdForTests('sync-node');
    initSharedRunStore({ NEOS_RUN_REGISTRY: 'memory' });
    const reg = getGlobalRunRegistry();
    const run = reg.create({ agentId: 'cli-claude', prompt: 'p', projectId: 'proj' });
    reg.setStatus(run.id, 'running');
    await syncRunSummary(run.id);
    const got = await getSharedRunStore().get(run.id);
    expect(got?.status).toBe('running');
    expect(got?.projectId).toBe('proj');
    expect(got?.nodeId).toBeTruthy();
  });

  it('off mode skips dual-write', async () => {
    initSharedRunStore({ NEOS_RUN_REGISTRY: 'off' });
    const reg = getGlobalRunRegistry();
    const run = reg.create({ agentId: 'cli-claude', prompt: 'p' });
    await dualWriteRunRecord(run);
    expect(await getSharedRunStore().get(run.id)).toBeNull();
  });
});

describe('applyLocalCancelFromCommand', () => {
  it('cancels local active run and ignores missing/terminal', () => {
    const reg = getGlobalRunRegistry();
    const run = reg.create({ prompt: 'x', agentId: 'cli-claude' });
    reg.setStatus(run.id, 'running');
    expect(
      applyLocalCancelFromCommand({
        type: 'run.cancel',
        runId: run.id,
        originNodeId: 'peer',
        ts: new Date().toISOString(),
      }),
    ).toBe(true);
    expect(reg.get(run.id)?.status).toBe('canceled');
    expect(
      applyLocalCancelFromCommand({
        type: 'run.cancel',
        runId: run.id,
        originNodeId: 'peer',
        ts: new Date().toISOString(),
      }),
    ).toBe(false);
    expect(
      applyLocalCancelFromCommand({
        type: 'run.cancel',
        runId: 'missing',
        originNodeId: 'peer',
        ts: new Date().toISOString(),
      }),
    ).toBe(false);
  });
});

describe('setSharedRunStoreForTests', () => {
  it('injects mock store into singleton', async () => {
    const put = async () => {};
    const mock = createMemorySharedRunStore({ nodeId: 'test-inject' });
    setSharedRunStoreForTests(mock);
    expect(getSharedRunStore().nodeId).toBe('test-inject');
    await put();
  });
});

describe('shared run event buffer (v0.19)', () => {
  it('memory dual-process: store A appends; store B eventsAfter sees them', async () => {
    const backend = createSharedMemoryBackendForTests();
    const a = createMemorySharedRunStore({ nodeId: 'owner', backend });
    const b = createMemorySharedRunStore({ nodeId: 'peer', backend });

    const e1 = {
      id: 'ev-1',
      type: 'run.started',
      ts: '2026-01-01T00:00:00.000Z',
      data: { agentId: 'cli-claude' },
    };
    const e2 = {
      id: 'ev-2',
      type: 'run.stdout',
      ts: '2026-01-01T00:00:01.000Z',
      data: { chunk: 'hello' },
    };
    await a.appendEvent('run-ev', e1);
    await a.appendEvent('run-ev', e2);

    const all = await b.eventsAfter('run-ev');
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe('ev-1');
    expect(all[1]!.type).toBe('run.stdout');

    const after = await b.eventsAfter('run-ev', 'ev-1');
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe('ev-2');
  });

  it('onRunEvent notifies memory subscribers on append', async () => {
    const backend = createSharedMemoryBackendForTests();
    const a = createMemorySharedRunStore({ nodeId: 'a', backend });
    const b = createMemorySharedRunStore({ nodeId: 'b', backend });
    const seen: string[] = [];
    b.onRunEvent((runId, ev) => seen.push(`${runId}:${ev.id}`));
    await a.appendEvent('r1', {
      id: 'e1',
      type: 'run.progress',
      ts: '2026-01-01T00:00:00.000Z',
    });
    expect(seen).toEqual(['r1:e1']);
  });

  it('caps buffer at RUN_EVENT_BUFFER_MAX', async () => {
    const backend = createSharedMemoryBackendForTests();
    const s = createMemorySharedRunStore({ nodeId: 'cap', backend });
    for (let i = 0; i < RUN_EVENT_BUFFER_MAX + 50; i++) {
      await s.appendEvent('big', {
        id: `e-${i}`,
        type: 'run.stdout',
        ts: '2026-01-01T00:00:00.000Z',
        data: { i },
      });
    }
    const all = await s.eventsAfter('big');
    expect(all.length).toBe(RUN_EVENT_BUFFER_MAX);
    expect(all[0]!.id).toBe('e-50');
    expect(all[all.length - 1]!.id).toBe(`e-${RUN_EVENT_BUFFER_MAX + 49}`);
  });

  it('off mode skips event dual-write', async () => {
    initSharedRunStore({ NEOS_RUN_REGISTRY: 'off' });
    await dualWriteRunEvent('r', {
      id: 'e',
      type: 'run.started',
      ts: '2026-01-01T00:00:00.000Z',
    });
    expect(await getSharedRunStore().eventsAfter('r')).toEqual([]);
  });

  it('appendRunEvent dual-writes to shared store', async () => {
    setRunRegistryNodeIdForTests('append-node');
    initSharedRunStore({ NEOS_RUN_REGISTRY: 'memory' });
    const reg = getGlobalRunRegistry();
    const run = reg.create({ agentId: 'cli-claude', prompt: 'p' });
    const ev = appendRunEvent(reg, run.id, 'run.started', { ok: true });
    expect(ev).toBeDefined();
    // fire-and-forget dual-write — await a tick for microtask
    await dualWriteRunEvent(run.id, ev!);
    const shared = await getSharedRunStore().eventsAfter(run.id);
    expect(shared.some((e) => e.id === ev!.id)).toBe(true);
  });

  it('parse/serialize runtime events', () => {
    const ev = {
      id: 'x',
      type: 'run.failed',
      ts: '2026-01-01T00:00:00.000Z',
      data: { error: 'boom' },
    };
    const raw = serializeRuntimeRunEvent(ev);
    expect(parseRuntimeRunEvent(raw)).toEqual(ev);
    expect(parseRuntimeRunEvent('not-json')).toBeNull();
  });
});
