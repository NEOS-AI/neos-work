/**
 * WorkerRuntime — first-class domain worker execution (PLAN_FOR_V0_4_0 Task 4).
 *
 * Builds a permission-scoped ToolRegistry, optional isolated workspace, injects
 * worker system prompt (+ design/memory), then runs AgentOrchestrator.
 */

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  DomainWorker,
  ToolPermissionProfile,
  WorkerMode,
  WorkspacePolicy,
} from '@neos-work/shared';

import type { LLMProviderAdapter } from '../llm/provider.js';
import { scrubErrorMessage, type Tool } from '../tools/base.js';
import { createFilesystemTools } from '../tools/filesystem.js';
import { ToolRegistry } from '../tools/registry.js';
import { createShellTool } from '../tools/shell.js';
import { createWebSearchTool } from '../tools/web-search.js';
import { AgentOrchestrator } from './orchestrator.js';
import type { AgentEvent } from './types.js';

// ── Constants ────────────────────────────────────────────────

const DEFAULT_WORKSPACE_BASE = join(homedir(), '.config', 'neos-work', 'workspaces');
const GOAL_MAX = AgentOrchestrator.GOAL_MAX_CHARS;
const SYSTEM_PROMPT_MAX = 100_000;
const DESIGN_CONTEXT_MAX = 32_000;
const MEMORY_CONTEXT_MAX = 32_000;
const INPUTS_JSON_MAX = 256 * 1024;
const HARD_TIMEOUT_MS_MAX = 30 * 60_000;
const DEFAULT_TIMEOUT_MS = 300_000;

/** Canonical tool names registered by the runtime. */
export const WORKER_TOOL_NAMES = {
  read_file: 'read_file',
  write_file: 'write_file',
  list_directory: 'list_directory',
  search_files: 'search_files',
  move_file: 'move_file',
  run_command: 'run_command',
  web_search: 'web_search',
} as const;

/** Legacy allowlist aliases used by harness/worker catalogs. */
const TOOL_ALIASES: Record<string, string> = {
  list_files: WORKER_TOOL_NAMES.list_directory,
  shell: WORKER_TOOL_NAMES.run_command,
  run_shell: WORKER_TOOL_NAMES.run_command,
};

// ── Types ────────────────────────────────────────────────────

export type WorkerRuntimeEvent =
  | {
      type: 'worker.started';
      workerRunId: string;
      workerId: string;
      nodeId?: string;
      workspaceRoot?: string;
      mode: WorkerMode;
    }
  | { type: 'worker.progress'; workerRunId: string; chunk: string; nodeId?: string }
  | {
      type: 'worker.completed';
      workerRunId: string;
      output: unknown;
      nodeId?: string;
      durationMs: number;
    }
  | {
      type: 'worker.failed';
      workerRunId: string;
      error: string;
      nodeId?: string;
      durationMs: number;
    }
  | { type: 'agent'; workerRunId: string; event: AgentEvent; nodeId?: string };

export interface WorkerRunRequest {
  worker: DomainWorker;
  goal: string;
  inputs?: Record<string, unknown>;
  mode?: WorkerMode;
  parent?: { nodeId: string; runId: string; workerRunId?: string };
  settings: Record<string, string>;
  signal?: AbortSignal;
  onEvent?: (e: WorkerRuntimeEvent) => void;
  /** Coordinator: factory to start child workers (Task 6 wires tools on top). */
  spawnWorker?: (req: WorkerRunRequest) => Promise<WorkerRunResult>;
  /** Injected adapter (tests / host). Required unless host only builds registry. */
  adapter?: LLMProviderAdapter;
  /** Appended to worker.systemPrompt */
  systemPromptAppend?: string;
  designSystemContent?: string;
  memoryContext?: string;
  /** Override ~/.config/neos-work/workspaces */
  workspaceBaseDir?: string;
  maxSteps?: number;
  model?: string;
  /** Extra tools (e.g. spawn_worker in Task 6) */
  extraTools?: Tool[];
  /**
   * When true (default), include tools from permission profile.
   * allowedTools on the worker further filters when non-empty.
   */
  applyPermissionProfile?: boolean;
}

export interface WorkerRunResult {
  ok: boolean;
  workerRunId: string;
  output: unknown;
  error?: string;
  durationMs: number;
  workspaceRoot?: string;
  mode: WorkerMode;
}

// ── Permission profile → default tools ───────────────────────

const READ_TOOLS = [
  WORKER_TOOL_NAMES.read_file,
  WORKER_TOOL_NAMES.list_directory,
  WORKER_TOOL_NAMES.search_files,
] as const;

const WRITE_TOOLS = [
  WORKER_TOOL_NAMES.write_file,
  WORKER_TOOL_NAMES.move_file,
] as const;

/**
 * Default tool allow-set for a permission profile (before worker.allowedTools filter).
 */
export function toolsForPermissionProfile(
  profile: ToolPermissionProfile | undefined,
): ReadonlySet<string> {
  const p = profile ?? 'full';
  switch (p) {
    case 'read_only':
      return new Set(READ_TOOLS);
    case 'read_write':
      return new Set([...READ_TOOLS, ...WRITE_TOOLS]);
    case 'execute':
      return new Set([...READ_TOOLS, ...WRITE_TOOLS, WORKER_TOOL_NAMES.run_command]);
    case 'network':
      return new Set([...READ_TOOLS, WORKER_TOOL_NAMES.web_search, WORKER_TOOL_NAMES.write_file]);
    case 'full':
    default:
      return new Set([
        ...READ_TOOLS,
        ...WRITE_TOOLS,
        WORKER_TOOL_NAMES.run_command,
        WORKER_TOOL_NAMES.web_search,
      ]);
  }
}

/** Normalize a tool name from catalogs (list_files → list_directory, shell → run_command). */
export function canonicalizeToolName(name: string): string {
  if (typeof name !== 'string' || /[\0\r\n]/.test(name)) return '';
  const t = name.trim();
  if (!t) return '';
  return TOOL_ALIASES[t] ?? TOOL_ALIASES[t.toLowerCase()] ?? t;
}

/**
 * Effective tool names for a worker: profile defaults ∩ optional allowedTools
 * (after alias canonicalization). Empty allowedTools → profile only.
 */
export function resolveWorkerToolNames(worker: DomainWorker, mode?: WorkerMode): string[] {
  const effectiveMode = mode ?? worker.defaultMode ?? 'solo';
  // Coordinator forces least-privilege base (read + no shell/write by default)
  let profile = worker.permissionProfile;
  if (effectiveMode === 'coordinator') {
    profile = profile === 'full' || profile === 'execute' || profile === 'read_write'
      ? 'read_only'
      : (profile ?? 'read_only');
  }
  const allowed = toolsForPermissionProfile(profile);
  const explicit = Array.isArray(worker.allowedTools) ? worker.allowedTools : undefined;
  if (!explicit || explicit.length === 0) {
    return [...allowed];
  }
  const wanted = new Set(
    explicit.map(canonicalizeToolName).filter((n) => n.length > 0 && n.length <= 100),
  );
  // Intersection: only tools both profile permits and allowlist names
  return [...allowed].filter((n) => wanted.has(n));
}

// ── Workspace ────────────────────────────────────────────────

export interface ResolveWorkspaceOptions {
  policy?: WorkspacePolicy;
  runId?: string;
  workerRunId?: string;
  baseDir?: string;
}

/**
 * Resolve (and create) the worker workspace root from policy.
 * - none → process.cwd() (no dedicated jail; FS tools still root at cwd)
 * - run → <base>/<runId>/[subdir]
 * - isolated → <base>/<runId>/<workerRunId>/
 */
export async function resolveWorkerWorkspace(
  opts: ResolveWorkspaceOptions,
): Promise<string> {
  const policy = opts.policy ?? { kind: 'run' };
  const base = opts.baseDir && opts.baseDir.trim()
    ? resolve(opts.baseDir.trim())
    : DEFAULT_WORKSPACE_BASE;

  if (policy.kind === 'none') {
    return process.cwd();
  }

  const runId = sanitizePathSegment(opts.runId) || 'default-run';
  if (policy.kind === 'isolated') {
    const workerRunId = sanitizePathSegment(opts.workerRunId) || crypto.randomUUID();
    const dir = join(base, runId, workerRunId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  // kind === 'run'
  const sub = policy.subdir ? sanitizePathSegment(policy.subdir) : '';
  const dir = sub ? join(base, runId, sub) : join(base, runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

function sanitizePathSegment(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  // Flatten path separators so segments cannot escape
  return raw
    .trim()
    .replace(/[/\\]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 200);
}

// ── Tool registry ────────────────────────────────────────────

export interface BuildWorkerToolRegistryOptions {
  worker: DomainWorker;
  workspaceRoot: string;
  mode?: WorkerMode;
  extraTools?: Tool[];
}

/**
 * Build a ToolRegistry scoped to the worker's permission profile + workspace root.
 * `extraTools` are always registered (coordinator spawn tools, host injections).
 */
export function buildWorkerToolRegistry(opts: BuildWorkerToolRegistryOptions): ToolRegistry {
  const { worker, workspaceRoot, mode, extraTools } = opts;
  const registry = new ToolRegistry();
  const allowedNames = new Set(resolveWorkerToolNames(worker, mode));

  const candidates: Tool[] = [
    createWebSearchTool(),
    ...createFilesystemTools(workspaceRoot),
    createShellTool(workspaceRoot),
  ];

  for (const tool of candidates) {
    if (allowedNames.has(tool.name)) {
      registry.register(tool);
    }
  }

  for (const tool of extraTools ?? []) {
    registry.register(tool);
  }

  return registry;
}

// ── Prompt assembly ──────────────────────────────────────────

export function buildWorkerSystemPrompt(opts: {
  worker: DomainWorker;
  systemPromptAppend?: string;
  designSystemContent?: string;
  memoryContext?: string;
}): string {
  let base = '';
  if (typeof opts.worker.systemPrompt === 'string') {
    base = opts.worker.systemPrompt.replace(/\0/g, '').trim();
  }
  const append =
    typeof opts.systemPromptAppend === 'string'
      ? opts.systemPromptAppend.replace(/\0/g, '').trim()
      : '';
  let prompt = [base, append].filter(Boolean).join('\n\n---\n');
  if (prompt.length > SYSTEM_PROMPT_MAX) {
    prompt = prompt.slice(0, SYSTEM_PROMPT_MAX);
  }

  let design = '';
  if (typeof opts.designSystemContent === 'string' && !/\0/.test(opts.designSystemContent)) {
    design = opts.designSystemContent.trim();
  }
  if (design) {
    if (design.length > DESIGN_CONTEXT_MAX) {
      design = design.slice(0, DESIGN_CONTEXT_MAX) + '\n\n…[design context truncated]';
    }
    prompt = `<!-- DESIGN CONTEXT -->\n${design}\n<!-- /DESIGN CONTEXT -->\n\n${prompt}`;
  }

  let memory = '';
  if (typeof opts.memoryContext === 'string' && !/\0/.test(opts.memoryContext)) {
    memory = opts.memoryContext.trim();
  }
  if (memory) {
    if (memory.length > MEMORY_CONTEXT_MAX) {
      memory = memory.slice(0, MEMORY_CONTEXT_MAX) + '\n\n…[memory truncated]';
    }
    prompt = `${prompt}\n\n---\n## Agent Memory\n${memory}`;
  }

  return prompt;
}

// ── Runtime ──────────────────────────────────────────────────

function clampMaxSteps(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(200, Math.floor(n));
}

function combineAbortSignals(
  signals: Array<AbortSignal | undefined>,
): { signal?: AbortSignal; cleanup: () => void } {
  const active = signals.filter((s): s is AbortSignal => !!s);
  if (active.length === 0) return { cleanup: () => {} };
  if (active.length === 1) return { signal: active[0], cleanup: () => {} };
  // Prefer AbortSignal.any when available (Node 20+)
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') {
    return { signal: anyFn(active), cleanup: () => {} };
  }
  const controller = new AbortController();
  const onAbort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  for (const s of active) {
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const s of active) s.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Run a domain worker (solo path). Coordinator spawn tools are registered via
 * extraTools / spawnWorker by Task 6; this runtime still supports mode metadata.
 */
export async function runWorker(req: WorkerRunRequest): Promise<WorkerRunResult> {
  const start = Date.now();
  const workerRunId =
    (req.parent?.workerRunId && sanitizePathSegment(req.parent.workerRunId)) ||
    crypto.randomUUID();
  const mode: WorkerMode = req.mode ?? req.worker.defaultMode ?? 'solo';
  const nodeId = req.parent?.nodeId;
  const emit = (e: WorkerRuntimeEvent) => {
    try {
      req.onEvent?.(e);
    } catch {
      // Host event handlers must not break the run
    }
  };

  let workspaceRoot: string | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timeoutController: AbortController | undefined;

  try {
    if (!req.adapter) {
      const error = 'LLM adapter is required to run a worker';
      emit({
        type: 'worker.failed',
        workerRunId,
        error,
        nodeId,
        durationMs: Date.now() - start,
      });
      return { ok: false, workerRunId, output: null, error, durationMs: Date.now() - start, mode };
    }

    workspaceRoot = await resolveWorkerWorkspace({
      policy: req.worker.workspace,
      runId: req.parent?.runId,
      workerRunId,
      baseDir: req.workspaceBaseDir,
    });

    emit({
      type: 'worker.started',
      workerRunId,
      workerId: req.worker.id,
      nodeId,
      workspaceRoot,
      mode,
    });

    const registry = buildWorkerToolRegistry({
      worker: req.worker,
      workspaceRoot,
      mode,
      extraTools: req.extraTools,
    });

    const systemPrompt = buildWorkerSystemPrompt({
      worker: req.worker,
      systemPromptAppend: req.systemPromptAppend,
      designSystemContent: req.designSystemContent,
      memoryContext: req.memoryContext,
    });

    let inputsJson = JSON.stringify(req.inputs ?? {});
    if (inputsJson.length > INPUTS_JSON_MAX) {
      inputsJson = inputsJson.slice(0, INPUTS_JSON_MAX) + '…[inputs truncated]';
    }

    let goalText = typeof req.goal === 'string' ? req.goal.replace(/\0/g, '').trim() : String(req.goal ?? '');
    if (!goalText) goalText = inputsJson;
    const fullGoal = systemPrompt
      ? `${systemPrompt}\n\n---\n## Goal\n${goalText}\n\n## Inputs\n${inputsJson}`
      : `## Goal\n${goalText}\n\n## Inputs\n${inputsJson}`;

    const maxSteps = clampMaxSteps(
      req.maxSteps ?? req.worker.constraints?.maxSteps,
      20,
    );

    const timeoutMsRaw = Number(req.worker.constraints?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const timeoutMs =
      Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
        ? Math.min(HARD_TIMEOUT_MS_MAX, Math.floor(timeoutMsRaw))
        : DEFAULT_TIMEOUT_MS;

    timeoutController = new AbortController();
    timeoutHandle = setTimeout(() => timeoutController!.abort(), timeoutMs);
    const { signal, cleanup } = combineAbortSignals([req.signal, timeoutController.signal]);

    const modelRaw = typeof req.model === 'string' && !/[\0\r\n]/.test(req.model)
      ? req.model.trim().slice(0, 200)
      : '';

    const orchestrator = new AgentOrchestrator(req.adapter, registry, {
      maxIterations: maxSteps,
      model: modelRaw || undefined,
    });

    let lastText = '';
    let runError: string | undefined;
    let completedOk = false;

    try {
      for await (const event of orchestrator.run(fullGoal.slice(0, GOAL_MAX + SYSTEM_PROMPT_MAX), signal)) {
        emit({ type: 'agent', workerRunId, event, nodeId });
        if (event.type === 'text') {
          const chunk = event.content ?? '';
          lastText += chunk;
          if (lastText.length > 2 * 1024 * 1024) {
            lastText = lastText.slice(-2 * 1024 * 1024);
          }
          emit({ type: 'worker.progress', workerRunId, chunk, nodeId });
        } else if (event.type === 'error') {
          runError = event.error;
        } else if (event.type === 'done') {
          completedOk = event.task.status === 'completed';
          if (event.task.status === 'failed' || event.task.status === 'cancelled') {
            runError = runError ?? `Worker ${event.task.status}`;
          }
        }
      }
    } finally {
      cleanup();
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    const durationMs = Date.now() - start;
    if (runError && !completedOk && !lastText) {
      const error = scrubErrorMessage(runError, 4_000) || 'Worker failed';
      emit({ type: 'worker.failed', workerRunId, error, nodeId, durationMs });
      return {
        ok: false,
        workerRunId,
        output: null,
        error,
        durationMs,
        workspaceRoot,
        mode,
      };
    }

    // Prefer accumulated text; if only error but we have text, still succeed with text
    const output = lastText || (runError ? { error: runError } : null);
    const ok = completedOk || (!!lastText && !req.signal?.aborted);
    if (ok) {
      emit({ type: 'worker.completed', workerRunId, output, nodeId, durationMs });
      return { ok: true, workerRunId, output, durationMs, workspaceRoot, mode };
    }
    const error =
      scrubErrorMessage(runError ?? 'Worker failed', 4_000) || 'Worker failed';
    emit({ type: 'worker.failed', workerRunId, error, nodeId, durationMs });
    return { ok: false, workerRunId, output, error, durationMs, workspaceRoot, mode };
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const durationMs = Date.now() - start;
    const error =
      scrubErrorMessage(err instanceof Error ? err.message : String(err), 4_000) ||
      'Worker failed';
    emit({ type: 'worker.failed', workerRunId, error, nodeId, durationMs });
    return {
      ok: false,
      workerRunId,
      output: null,
      error,
      durationMs,
      workspaceRoot,
      mode,
    };
  }
}

/** Class facade for DI / future extension. */
export class WorkerRuntime {
  run(req: WorkerRunRequest): Promise<WorkerRunResult> {
    return runWorker(req);
  }
}
