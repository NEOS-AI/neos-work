/**
 * Run warehouse unit tests (v0.23 Track P).
 * Uses in-memory + off warehouses only — no real Postgres required in CI.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createMemoryWarehouse,
  createOffWarehouse,
  createRunWarehouse,
  getRunWarehouse,
  initRunWarehouse,
  resetRunWarehouseForTests,
  resolveRunWarehouseMode,
  resolveRunWarehouseSchema,
  resolveRunWarehouseUrl,
  setRunWarehouseForTests,
  type WarehouseRunSummary,
} from './run-warehouse.js';

function sampleSummary(id = 'run-1'): WarehouseRunSummary {
  return {
    id,
    status: 'running',
    nodeId: 'node-a',
    projectId: 'proj-1',
    collabSessionId: 'sess-1',
    agentId: 'cli-claude',
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:01.000Z',
    completedAt: null,
    updatedAt: '2026-01-01T00:00:02.000Z',
  };
}

afterEach(() => {
  resetRunWarehouseForTests();
  delete process.env.NEOS_RUN_WAREHOUSE;
  delete process.env.NEOS_RUN_WAREHOUSE_URL;
  delete process.env.NEOS_RUN_WAREHOUSE_SCHEMA;
  delete process.env.DATABASE_URL;
});

describe('resolveRunWarehouseMode / url / schema', () => {
  it('defaults to off', () => {
    expect(resolveRunWarehouseMode({})).toBe('off');
  });

  it('parses off|postgres and aliases', () => {
    expect(resolveRunWarehouseMode({ NEOS_RUN_WAREHOUSE: 'off' })).toBe('off');
    expect(resolveRunWarehouseMode({ NEOS_RUN_WAREHOUSE: '0' })).toBe('off');
    expect(resolveRunWarehouseMode({ NEOS_RUN_WAREHOUSE: 'false' })).toBe('off');
    expect(resolveRunWarehouseMode({ NEOS_RUN_WAREHOUSE: 'postgres' })).toBe('postgres');
    expect(resolveRunWarehouseMode({ NEOS_RUN_WAREHOUSE: 'POSTGRES' })).toBe('postgres');
    expect(resolveRunWarehouseMode({ NEOS_RUN_WAREHOUSE: 'pg' })).toBe('postgres');
    expect(resolveRunWarehouseMode({ NEOS_RUN_WAREHOUSE: 'on' })).toBe('postgres');
    expect(resolveRunWarehouseMode({ NEOS_RUN_WAREHOUSE: 'memory' })).toBe('off');
  });

  it('prefers NEOS_RUN_WAREHOUSE_URL over DATABASE_URL', () => {
    expect(
      resolveRunWarehouseUrl({
        NEOS_RUN_WAREHOUSE_URL: 'postgres://a/db',
        DATABASE_URL: 'postgres://b/db',
      }),
    ).toBe('postgres://a/db');
    expect(resolveRunWarehouseUrl({ DATABASE_URL: 'postgres://b/db' })).toBe(
      'postgres://b/db',
    );
    expect(resolveRunWarehouseUrl({})).toBeNull();
  });

  it('defaults schema to public', () => {
    expect(resolveRunWarehouseSchema({})).toBe('public');
    expect(resolveRunWarehouseSchema({ NEOS_RUN_WAREHOUSE_SCHEMA: 'neos' })).toBe(
      'neos',
    );
    expect(resolveRunWarehouseSchema({ NEOS_RUN_WAREHOUSE_SCHEMA: 'Bad;Name' })).toBe(
      'public',
    );
  });
});

describe('createOffWarehouse', () => {
  it('no-ops put/get/append/list', async () => {
    const w = createOffWarehouse();
    expect(w.status().kind).toBe('off');
    expect(w.status().ready).toBe(true);

    await w.putSummary(sampleSummary());
    expect(await w.getSummary('run-1')).toBeNull();

    await w.appendEvent('run-1', {
      id: 'e1',
      type: 'run.started',
      ts: '2026-01-01T00:00:00.000Z',
    });
    expect(await w.listEventsAfter('run-1')).toEqual([]);
    await w.close();
  });
});

describe('createMemoryWarehouse', () => {
  it('put/get summary (upsert last write wins)', async () => {
    const w = createMemoryWarehouse();
    expect(w.status().kind).toBe('memory');

    await w.putSummary(sampleSummary('r1'));
    const got = await w.getSummary('r1');
    expect(got?.status).toBe('running');
    expect(got?.projectId).toBe('proj-1');
    expect(got?.nodeId).toBe('node-a');

    await w.putSummary({ ...sampleSummary('r1'), status: 'succeeded' });
    expect((await w.getSummary('r1'))?.status).toBe('succeeded');
    expect(await w.getSummary('missing')).toBeNull();
  });

  it('append/list events after cursor', async () => {
    const w = createMemoryWarehouse();
    await w.appendEvent('run-x', {
      id: 'ev-1',
      type: 'run.started',
      ts: '2026-01-01T00:00:00.000Z',
      data: { ok: true },
    });
    await w.appendEvent('run-x', {
      id: 'ev-2',
      type: 'run.stdout',
      ts: '2026-01-01T00:00:01.000Z',
      data: { chunk: 'hi' },
    });
    // dedup by event id
    await w.appendEvent('run-x', {
      id: 'ev-1',
      type: 'run.started',
      ts: '2026-01-01T00:00:00.000Z',
    });

    const all = await w.listEventsAfter('run-x');
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe('ev-1');
    expect(all[1]!.type).toBe('run.stdout');

    const after = await w.listEventsAfter('run-x', 'ev-1');
    expect(after.map((e) => e.id)).toEqual(['ev-2']);
    expect(await w.listEventsAfter('other')).toEqual([]);
  });

  it('rejects invalid run ids', async () => {
    const w = createMemoryWarehouse();
    await w.putSummary({ ...sampleSummary(), id: 'bad\nid' });
    expect(await w.getSummary('bad\nid')).toBeNull();
    await w.appendEvent('bad\nid', {
      id: 'e',
      type: 'run.started',
      ts: '2026-01-01T00:00:00.000Z',
    });
    expect(await w.listEventsAfter('bad\nid')).toEqual([]);
  });
});

describe('createRunWarehouse / init singleton', () => {
  it('createRunWarehouse defaults to off', () => {
    const w = createRunWarehouse({});
    expect(w.status().kind).toBe('off');
  });

  it('postgres mode without URL returns postgres-stub', () => {
    const w = createRunWarehouse({ NEOS_RUN_WAREHOUSE: 'postgres' });
    expect(w.status().kind).toBe('postgres-stub');
    expect(w.status().ready).toBe(false);
  });

  it('initRunWarehouse + getRunWarehouse singleton', async () => {
    const w = initRunWarehouse({ NEOS_RUN_WAREHOUSE: 'off' });
    expect(getRunWarehouse()).toBe(w);
    expect(getRunWarehouse().status().kind).toBe('off');
  });

  it('setRunWarehouseForTests injects memory warehouse', async () => {
    const mem = createMemoryWarehouse();
    setRunWarehouseForTests(mem);
    await getRunWarehouse().putSummary(sampleSummary('inj'));
    expect((await getRunWarehouse().getSummary('inj'))?.id).toBe('inj');
  });
});

describe('dual-write best-effort via warehouse injection', () => {
  beforeEach(() => {
    setRunWarehouseForTests(createMemoryWarehouse());
  });

  it('putSummary + appendEvent survive through getRunWarehouse', async () => {
    const wh = getRunWarehouse();
    await wh.putSummary(sampleSummary('dw-1'));
    await wh.appendEvent('dw-1', {
      id: 'e1',
      type: 'run.started',
      ts: '2026-01-01T00:00:00.000Z',
    });
    expect((await wh.getSummary('dw-1'))?.status).toBe('running');
    expect((await wh.listEventsAfter('dw-1')).map((e) => e.id)).toEqual(['e1']);
  });
});
