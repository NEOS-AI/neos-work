import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendRunEventLog,
  pruneRunEventLogs,
  readRunEventLogAfter,
  readRunSummaryLog,
  resolveRunEventLogMode,
  resolveRunLogRetention,
  runEventLogPath,
  runEventLogStatus,
  runSummaryLogPath,
  writeRunSummaryLog,
  DEFAULT_RUN_LOG_MAX_AGE_HOURS,
  DEFAULT_RUN_LOG_MAX_RUNS,
} from './run-event-log.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  delete process.env.NEOS_DATA_DIR;
  delete process.env.NEOS_RUN_EVENT_LOG;
  delete process.env.NEOS_RUN_EVENT_LOG_MAX_AGE_HOURS;
  delete process.env.NEOS_RUN_EVENT_LOG_MAX_RUNS;
  delete process.env.NEOS_RUN_EVENT_LOG_MAX_FILE_BYTES;
});

function tmpData(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-run-log-'));
  tmpDirs.push(d);
  process.env.NEOS_DATA_DIR = d;
  return d;
}

describe('resolveRunEventLogMode', () => {
  it('parses env', () => {
    expect(resolveRunEventLogMode({})).toBe('auto');
    expect(resolveRunEventLogMode({ NEOS_RUN_EVENT_LOG: 'off' })).toBe('off');
    expect(resolveRunEventLogMode({ NEOS_RUN_EVENT_LOG: 'on' })).toBe('on');
  });
});

describe('retention env', () => {
  it('defaults and overrides', () => {
    expect(resolveRunLogRetention({})).toMatchObject({
      maxAgeHours: DEFAULT_RUN_LOG_MAX_AGE_HOURS,
      maxRuns: DEFAULT_RUN_LOG_MAX_RUNS,
    });
    expect(
      resolveRunLogRetention({
        NEOS_RUN_EVENT_LOG_MAX_AGE_HOURS: '24',
        NEOS_RUN_EVENT_LOG_MAX_RUNS: '10',
        NEOS_RUN_EVENT_LOG_MAX_FILE_BYTES: '1024',
      }),
    ).toEqual({ maxAgeHours: 24, maxRuns: 10, maxFileBytes: 1024 });
  });
});

describe('append + read', () => {
  it('writes JSONL and reads after cursor', () => {
    tmpData();
    process.env.NEOS_RUN_EVENT_LOG = 'on';
    const runId = '11111111-1111-1111-1111-111111111111';
    const e1 = {
      id: 'ev1',
      type: 'run.started' as const,
      ts: '2026-01-01T00:00:00.000Z',
      data: { n: 1 },
    };
    const e2 = {
      id: 'ev2',
      type: 'run.progress' as const,
      ts: '2026-01-01T00:00:01.000Z',
      data: { n: 2 },
    };
    expect(appendRunEventLog(runId, e1)).toBe(true);
    expect(appendRunEventLog(runId, e2)).toBe(true);
    const file = runEventLogPath(runId)!;
    expect(fs.existsSync(file)).toBe(true);
    expect(readRunEventLogAfter(runId).map((e) => e.id)).toEqual(['ev1', 'ev2']);
    expect(readRunEventLogAfter(runId, 'ev1').map((e) => e.id)).toEqual(['ev2']);
  });

  it('off mode does not write', () => {
    tmpData();
    process.env.NEOS_RUN_EVENT_LOG = 'off';
    const runId = '22222222-2222-2222-2222-222222222222';
    expect(
      appendRunEventLog(runId, {
        id: 'x',
        type: 'run.started',
        ts: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('rejects unsafe run ids', () => {
    tmpData();
    process.env.NEOS_RUN_EVENT_LOG = 'on';
    expect(
      appendRunEventLog('../escape', {
        id: 'x',
        type: 'run.started',
        ts: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});

describe('summary.json (M1)', () => {
  it('writes and reads durable summary', () => {
    tmpData();
    process.env.NEOS_RUN_EVENT_LOG = 'on';
    const id = '33333333-3333-3333-3333-333333333333';
    expect(
      writeRunSummaryLog({
        id,
        status: 'succeeded',
        nodeId: 'n1',
        projectId: 'p1',
        collabSessionId: null,
        agentId: 'cli',
        error: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        startedAt: '2026-01-01T00:00:01.000Z',
        completedAt: '2026-01-01T00:00:02.000Z',
        updatedAt: '2026-01-01T00:00:02.000Z',
      }),
    ).toBe(true);
    expect(fs.existsSync(runSummaryLogPath(id)!)).toBe(true);
    const got = readRunSummaryLog(id);
    expect(got?.status).toBe('succeeded');
    expect(got?.nodeId).toBe('n1');
    expect(got?.projectId).toBe('p1');
  });
});

describe('pruneRunEventLogs (M0)', () => {
  it('removes by age and by count', () => {
    const root = tmpData();
    process.env.NEOS_RUN_EVENT_LOG = 'on';
    process.env.NEOS_RUN_EVENT_LOG_MAX_AGE_HOURS = '1';
    process.env.NEOS_RUN_EVENT_LOG_MAX_RUNS = '2';

    const runsRoot = path.join(root, 'runs');
    fs.mkdirSync(runsRoot, { recursive: true });

    const oldId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const midId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const newId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    for (const id of [oldId, midId, newId]) {
      const d = path.join(runsRoot, id);
      fs.mkdirSync(d);
      fs.writeFileSync(path.join(d, 'events.jsonl'), '{"id":"e"}\n');
    }
    const now = Date.now();
    // old: 2 days ago
    fs.utimesSync(path.join(runsRoot, oldId), new Date(now - 50 * 3600_000), new Date(now - 50 * 3600_000));
    fs.utimesSync(path.join(runsRoot, midId), new Date(now - 1000), new Date(now - 1000));
    fs.utimesSync(path.join(runsRoot, newId), new Date(now), new Date(now));

    const r = pruneRunEventLogs(process.env, now);
    expect(r.scanned).toBe(3);
    expect(r.reasons.age).toBe(1);
    expect(fs.existsSync(path.join(runsRoot, oldId))).toBe(false);
    // maxRuns=2 but after age only 2 left — no count remove required
    // Add a fourth young dir so count prune fires
    const extra = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    fs.mkdirSync(path.join(runsRoot, extra));
    fs.writeFileSync(path.join(runsRoot, extra, 'events.jsonl'), 'x\n');
    fs.utimesSync(path.join(runsRoot, extra), new Date(now - 500), new Date(now - 500));

    const r2 = pruneRunEventLogs(process.env, now);
    // mid, new, extra = 3 > max 2 → remove oldest (mid)
    expect(r2.reasons.count).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(runsRoot, newId))).toBe(true);
  });
});

describe('status', () => {
  it('reports root and retention', () => {
    const d = tmpData();
    process.env.NEOS_RUN_EVENT_LOG = 'auto';
    const st = runEventLogStatus();
    expect(st.enabled).toBe(true);
    expect(st.root).toBe(path.join(d, 'runs'));
    expect(st.retention.maxRuns).toBe(DEFAULT_RUN_LOG_MAX_RUNS);
  });
});
