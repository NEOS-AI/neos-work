/**
 * Coordinator spawn tools (PLAN_FOR_V0_4_0 Task 6).
 *
 * spawn_worker / await_workers / list_workers — used when an agent runs in
 * coordinator mode. Child workers are always forced to `solo` (no nesting).
 */

import type { DomainWorker } from '@neos-work/shared';

import type { WorkerRunRequest, WorkerRunResult, WorkerRuntimeEvent } from '../agent/worker-runtime.js';
import { scrubErrorMessage, type Tool, type ToolResult } from './base.js';

export const DEFAULT_MAX_SPAWNED_WORKERS = 4;
export const HARD_MAX_SPAWNED_WORKERS = 8;
export const DEFAULT_CONCURRENCY = 4;
export const SPAWN_GOAL_MAX_CHARS = 50_000;
export const SPAWN_INPUTS_MAX_CHARS = 256 * 1024;
export const AWAIT_TIMEOUT_MS_DEFAULT = 300_000;
export const AWAIT_TIMEOUT_MS_MAX = 30 * 60_000;

export interface WorkerCatalogEntry {
  id: string;
  name: string;
  domain: string;
  description: string;
}

export interface CoordinatorSpawnDeps {
  /** Resolve a DomainWorker by id (registry). */
  resolveWorker: (id: string) => DomainWorker | undefined;
  /** List catalog entries; optional domain filter. */
  listWorkers: (domain?: string) => WorkerCatalogEntry[];
  /**
   * Execute a child worker. Implementations must force `mode: 'solo'` and
   * must not attach coordinator spawn tools to the child.
   */
  runChild: (req: WorkerRunRequest) => Promise<WorkerRunResult>;
  parent: { nodeId?: string; runId: string };
  settings: Record<string, string>;
  signal?: AbortSignal;
  onEvent?: (e: WorkerRuntimeEvent) => void;
  /** Restrict which worker ids may be spawned. */
  allowedWorkerIds?: string[];
  /** Soft cap (default 4); clamped to HARD_MAX_SPAWNED_WORKERS. */
  maxSpawnedWorkers?: number;
  /** Max concurrent in-flight children (default 4). */
  concurrency?: number;
  workspaceBaseDir?: string;
  /** Shared fields for children (adapter, model, etc.) */
  childDefaults?: Partial<
    Pick<
      WorkerRunRequest,
      'adapter' | 'model' | 'designSystemContent' | 'memoryContext' | 'workspaceBaseDir'
    >
  >;
}

interface TrackedChild {
  workerRunId: string;
  workerId: string;
  promise: Promise<WorkerRunResult>;
  result?: WorkerRunResult;
  controller: AbortController;
}

function clampMaxSpawned(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_SPAWNED_WORKERS;
  return Math.min(HARD_MAX_SPAWNED_WORKERS, Math.floor(n));
}

function clampConcurrency(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
  return Math.min(HARD_MAX_SPAWNED_WORKERS, Math.floor(n));
}

function safeId(raw: unknown, max = 200): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim().slice(0, max);
}

function safeGoal(raw: unknown): string {
  if (typeof raw !== 'string') {
    const s = String(raw ?? '');
    return s.replace(/\0/g, '').trim().slice(0, SPAWN_GOAL_MAX_CHARS);
  }
  if (/[\0]/.test(raw)) return raw.replace(/\0/g, '').trim().slice(0, SPAWN_GOAL_MAX_CHARS);
  // Allow newlines in multi-line goals; reject lone CR later if needed
  return raw.trim().slice(0, SPAWN_GOAL_MAX_CHARS);
}

function safeInputs(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  try {
    const json = JSON.stringify(raw);
    if (json.length > SPAWN_INPUTS_MAX_CHARS) {
      return { _truncated: true, preview: json.slice(0, 256) };
    }
  } catch {
    return undefined;
  }
  return raw as Record<string, unknown>;
}

/**
 * In-memory coordinator session: tracks spawned children, enforces caps, and
 * builds the three coordinator tools.
 */
export class CoordinatorSession {
  private readonly children = new Map<string, TrackedChild>();
  private spawnedCount = 0;
  private inFlight = 0;
  private readonly waitQueue: Array<() => void> = [];
  readonly maxSpawned: number;
  readonly concurrency: number;
  private readonly allowed: Set<string> | undefined;

  constructor(private readonly deps: CoordinatorSpawnDeps) {
    this.maxSpawned = clampMaxSpawned(deps.maxSpawnedWorkers);
    this.concurrency = clampConcurrency(deps.concurrency);
    if (Array.isArray(deps.allowedWorkerIds) && deps.allowedWorkerIds.length > 0) {
      this.allowed = new Set(
        deps.allowedWorkerIds.map((id) => safeId(id)).filter(Boolean),
      );
    }
  }

  get spawned(): number {
    return this.spawnedCount;
  }

  get trackedIds(): string[] {
    return [...this.children.keys()];
  }

  /** Abort all in-flight children (e.g. parent cancel). */
  abortAll(): void {
    for (const child of this.children.values()) {
      if (!child.controller.signal.aborted) child.controller.abort();
    }
  }

  private async acquireSlot(signal?: AbortSignal): Promise<void> {
    if (this.inFlight < this.concurrency) {
      this.inFlight += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const idx = this.waitQueue.indexOf(tryAcquire);
        if (idx >= 0) this.waitQueue.splice(idx, 1);
        reject(new Error('Cancelled while waiting for spawn slot'));
      };
      const tryAcquire = () => {
        signal?.removeEventListener('abort', onAbort);
        this.inFlight += 1;
        resolve();
      };
      if (signal?.aborted) {
        reject(new Error('Cancelled while waiting for spawn slot'));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waitQueue.push(tryAcquire);
    });
  }

  private releaseSlot(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.waitQueue.shift();
    if (next) next();
  }

  async spawn(input: {
    workerId: string;
    goal: string;
    inputs?: Record<string, unknown>;
  }): Promise<ToolResult> {
    if (this.deps.signal?.aborted) {
      return { success: false, output: null, error: 'Parent run was cancelled' };
    }

    const workerId = safeId(input.workerId);
    if (!workerId) {
      return { success: false, output: null, error: 'workerId is required' };
    }

    if (this.allowed && !this.allowed.has(workerId)) {
      return {
        success: false,
        output: null,
        error: `Worker "${workerId}" is not in allowedWorkerIds`,
      };
    }

    if (this.spawnedCount >= this.maxSpawned) {
      return {
        success: false,
        output: null,
        error: `maxSpawnedWorkers exceeded (cap ${this.maxSpawned})`,
      };
    }

    const worker = this.deps.resolveWorker(workerId);
    if (!worker) {
      return { success: false, output: null, error: `Unknown worker: ${workerId}` };
    }

    const goal = safeGoal(input.goal);
    if (!goal) {
      return { success: false, output: null, error: 'goal is required' };
    }

    const inputs = safeInputs(input.inputs);
    const workerRunId = crypto.randomUUID();
    const controller = new AbortController();
    const parentSignal = this.deps.signal;
    const onParentAbort = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort();
      else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    this.spawnedCount += 1;

    const runPromise = (async (): Promise<WorkerRunResult> => {
      await this.acquireSlot(controller.signal);
      try {
        // Force solo — nested coordinators are forbidden (Q3/Task 6)
        const childWorker: DomainWorker = {
          ...worker,
          defaultMode: 'solo',
        };
        const result = await this.deps.runChild({
          worker: childWorker,
          goal,
          inputs,
          mode: 'solo',
          parent: {
            nodeId: this.deps.parent.nodeId ?? '',
            runId: this.deps.parent.runId,
            workerRunId,
          },
          settings: this.deps.settings,
          signal: controller.signal,
          onEvent: this.deps.onEvent,
          workspaceBaseDir: this.deps.workspaceBaseDir ?? this.deps.childDefaults?.workspaceBaseDir,
          adapter: this.deps.childDefaults?.adapter,
          model: this.deps.childDefaults?.model,
          designSystemContent: this.deps.childDefaults?.designSystemContent,
          memoryContext: this.deps.childDefaults?.memoryContext,
          // Never pass spawnWorker / extraTools — children cannot spawn
        });
        return result;
      } finally {
        this.releaseSlot();
        parentSignal?.removeEventListener('abort', onParentAbort);
      }
    })();

    const tracked: TrackedChild = {
      workerRunId,
      workerId,
      promise: runPromise,
      controller,
    };
    this.children.set(workerRunId, tracked);

    // Store result when done
    void runPromise.then((result) => {
      tracked.result = result;
    });

    return {
      success: true,
      output: {
        workerRunId,
        workerId,
        status: 'running',
      },
    };
  }

  async awaitWorkers(input: {
    workerRunIds: string[];
    timeoutMs?: number;
  }): Promise<ToolResult> {
    const idsRaw = Array.isArray(input.workerRunIds) ? input.workerRunIds : [];
    const ids = idsRaw.map((id) => safeId(id)).filter(Boolean);
    if (ids.length === 0) {
      return { success: false, output: null, error: 'workerRunIds is required' };
    }

    const timeoutRaw = Number(input.timeoutMs ?? AWAIT_TIMEOUT_MS_DEFAULT);
    const timeoutMs =
      Number.isFinite(timeoutRaw) && timeoutRaw > 0
        ? Math.min(AWAIT_TIMEOUT_MS_MAX, Math.floor(timeoutRaw))
        : AWAIT_TIMEOUT_MS_DEFAULT;

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

    try {
      const results = await Promise.all(
        ids.map(async (id) => {
          const child = this.children.get(id);
          if (!child) {
            return {
              workerRunId: id,
              ok: false,
              output: null,
              error: `Unknown workerRunId: ${id}`,
            };
          }
          if (timeoutController.signal.aborted) {
            return {
              workerRunId: id,
              ok: false,
              output: null,
              error: 'await_workers timed out',
            };
          }
          try {
            const raced = await Promise.race([
              child.promise,
              new Promise<never>((_, reject) => {
                const onAbort = () => reject(new Error('await_workers timed out'));
                if (timeoutController.signal.aborted) onAbort();
                else timeoutController.signal.addEventListener('abort', onAbort, { once: true });
              }),
            ]);
            return {
              workerRunId: id,
              ok: raced.ok,
              output: raced.output,
              error: raced.error,
              durationMs: raced.durationMs,
            };
          } catch (err) {
            const error =
              scrubErrorMessage(err instanceof Error ? err.message : String(err), 2_000) ||
              'await failed';
            return { workerRunId: id, ok: false, output: null, error };
          }
        }),
      );

      return { success: true, output: { results } };
    } finally {
      clearTimeout(timer);
    }
  }

  list(domain?: string): ToolResult {
    let domainFilter: string | undefined;
    if (typeof domain === 'string' && domain.trim() && !/[\0\r\n]/.test(domain)) {
      domainFilter = domain.trim().toLowerCase();
    }
    let workers = this.deps.listWorkers(domainFilter);
    if (this.allowed) {
      workers = workers.filter((w) => this.allowed!.has(w.id));
    }
    return {
      success: true,
      output: {
        workers: workers.map((w) => ({
          id: w.id,
          name: w.name,
          domain: w.domain,
          description: w.description,
        })),
      },
    };
  }

  /** Build the three coordinator tools bound to this session. */
  createTools(): Tool[] {
    return [
      {
        name: 'spawn_worker',
        description:
          'Start a child domain worker (always solo). Returns workerRunId immediately; ' +
          'use await_workers to collect results. Respects maxSpawnedWorkers and concurrency.',
        inputSchema: {
          type: 'object',
          properties: {
            workerId: {
              type: 'string',
              description: 'Id of a registered domain worker (e.g. research_web)',
            },
            goal: { type: 'string', description: 'Task goal for the child worker' },
            inputs: {
              type: 'object',
              description: 'Optional structured inputs for the child',
            },
          },
          required: ['workerId', 'goal'],
        },
        execute: async (input) => {
          try {
            return await this.spawn({
              workerId: String(input.workerId ?? ''),
              goal: String(input.goal ?? ''),
              inputs:
                input.inputs && typeof input.inputs === 'object' && !Array.isArray(input.inputs)
                  ? (input.inputs as Record<string, unknown>)
                  : undefined,
            });
          } catch (err) {
            return {
              success: false,
              output: null,
              error:
                scrubErrorMessage(err instanceof Error ? err.message : String(err), 2_000) ||
                'spawn_worker failed',
            };
          }
        },
      },
      {
        name: 'await_workers',
        description:
          'Wait for one or more previously spawned workers to finish. Returns ok/output/error per id.',
        inputSchema: {
          type: 'object',
          properties: {
            workerRunIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'workerRunId values from spawn_worker',
            },
            timeoutMs: {
              type: 'number',
              description: `Max wait in ms (default ${AWAIT_TIMEOUT_MS_DEFAULT}, max ${AWAIT_TIMEOUT_MS_MAX})`,
            },
          },
          required: ['workerRunIds'],
        },
        execute: async (input) => {
          try {
            const ids = Array.isArray(input.workerRunIds)
              ? input.workerRunIds.map((x) => String(x ?? ''))
              : [];
            return await this.awaitWorkers({
              workerRunIds: ids,
              timeoutMs:
                typeof input.timeoutMs === 'number' ? input.timeoutMs : Number(input.timeoutMs),
            });
          } catch (err) {
            return {
              success: false,
              output: null,
              error:
                scrubErrorMessage(err instanceof Error ? err.message : String(err), 2_000) ||
                'await_workers failed',
            };
          }
        },
      },
      {
        name: 'list_workers',
        description:
          'List available domain workers that may be spawned (optional domain filter).',
        inputSchema: {
          type: 'object',
          properties: {
            domain: {
              type: 'string',
              description: 'Optional pack id filter (finance|coding|research|general)',
            },
          },
        },
        execute: async (input) => {
          try {
            const domain =
              typeof input.domain === 'string' ? input.domain : undefined;
            return this.list(domain);
          } catch (err) {
            return {
              success: false,
              output: null,
              error:
                scrubErrorMessage(err instanceof Error ? err.message : String(err), 2_000) ||
                'list_workers failed',
            };
          }
        },
      },
    ];
  }
}

/** Convenience factory. */
export function createCoordinatorTools(deps: CoordinatorSpawnDeps): {
  session: CoordinatorSession;
  tools: Tool[];
} {
  const session = new CoordinatorSession(deps);
  return { session, tools: session.createTools() };
}
