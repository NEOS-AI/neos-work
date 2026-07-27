/**
 * In-memory run registry (Task 3 foundation).
 * Optional later: persist events.jsonl under project dir.
 */

import type {
  RuntimeRunEvent,
  RuntimeRunEventType,
  RuntimeRunRecord,
  RuntimeRunStatus,
} from './types.js';

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_EVENTS = 5_000;

export interface RunRegistryOptions {
  ttlMs?: number;
  maxEvents?: number;
}

export class RunRegistry {
  private runs = new Map<string, RuntimeRunRecord>();
  private readonly ttlMs: number;
  private readonly maxEvents: number;

  constructor(opts: RunRegistryOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;
  }

  create(input: {
    id?: string;
    agentId?: string | null;
    projectId?: string | null;
    prompt?: string;
    editContext?: unknown;
  }): RuntimeRunRecord {
    this.gc();
    const id = input.id ?? crypto.randomUUID();
    const now = new Date().toISOString();
    const record: RuntimeRunRecord = {
      id,
      status: 'queued',
      agentId: input.agentId ?? null,
      projectId: input.projectId ?? null,
      prompt: input.prompt,
      editContext: input.editContext,
      error: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      events: [],
      abort: new AbortController(),
    };
    this.runs.set(id, record);
    return record;
  }

  get(id: string): RuntimeRunRecord | undefined {
    if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return undefined;
    return this.runs.get(id.trim());
  }

  list(filter?: { projectId?: string; status?: RuntimeRunStatus }): RuntimeRunRecord[] {
    this.gc();
    let rows = [...this.runs.values()];
    if (filter?.projectId) {
      rows = rows.filter((r) => r.projectId === filter.projectId);
    }
    if (filter?.status) {
      rows = rows.filter((r) => r.status === filter.status);
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  appendEvent(
    id: string,
    type: RuntimeRunEventType,
    data?: unknown,
  ): RuntimeRunEvent | undefined {
    const run = this.get(id);
    if (!run) return undefined;
    const event: RuntimeRunEvent = {
      id: crypto.randomUUID(),
      type,
      ts: new Date().toISOString(),
      data,
    };
    run.events.push(event);
    if (run.events.length > this.maxEvents) {
      run.events.splice(0, run.events.length - this.maxEvents);
    }
    return event;
  }

  setStatus(id: string, status: RuntimeRunStatus, error?: string | null): boolean {
    const run = this.get(id);
    if (!run) return false;
    run.status = status;
    if (status === 'running' && !run.startedAt) {
      run.startedAt = new Date().toISOString();
    }
    if (status === 'succeeded' || status === 'failed' || status === 'canceled') {
      run.completedAt = new Date().toISOString();
    }
    if (error !== undefined) run.error = error;
    return true;
  }

  cancel(id: string): boolean {
    const run = this.get(id);
    if (!run) return false;
    if (run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled') {
      return false;
    }
    try {
      run.abort?.abort();
    } catch {
      // ignore
    }
    this.setStatus(id, 'canceled');
    this.appendEvent(id, 'run.canceled');
    return true;
  }

  eventsAfter(id: string, afterEventId?: string | null): RuntimeRunEvent[] {
    const run = this.get(id);
    if (!run) return [];
    if (!afterEventId) return [...run.events];
    const idx = run.events.findIndex((e) => e.id === afterEventId);
    if (idx < 0) return [...run.events];
    return run.events.slice(idx + 1);
  }

  /** Drop completed runs older than TTL. */
  gc(now = Date.now()): number {
    let removed = 0;
    for (const [id, run] of this.runs) {
      const terminal =
        run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled';
      if (!terminal || !run.completedAt) continue;
      const t = Date.parse(run.completedAt);
      if (!Number.isFinite(t)) continue;
      if (now - t > this.ttlMs) {
        this.runs.delete(id);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.runs.clear();
  }

  get size(): number {
    return this.runs.size;
  }
}

/** Process-wide singleton for the server daemon. */
let _global: RunRegistry | null = null;

export function getGlobalRunRegistry(): RunRegistry {
  if (!_global) _global = new RunRegistry();
  return _global;
}

export function resetGlobalRunRegistry(): void {
  _global?.clear();
  _global = null;
}
