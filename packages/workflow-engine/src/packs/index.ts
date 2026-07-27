/**
 * Domain Pack registry — built-in packs + worker resolution (PLAN_FOR_V0_4_0 Task 3).
 *
 * Workers are the source of truth. Harness APIs re-export these symbols for
 * v0.3.x / v0.4.x compatibility (`resolveHarness` → `resolveWorker`, etc.).
 */

import type { DomainPack, DomainWorker, ToolPermissionProfile, WorkspacePolicy, WorkerMode } from '@neos-work/shared';
import { FINANCE_BLOCK_IDS, FINANCE_WORKERS } from './finance.js';
import { CODING_BLOCK_IDS, CODING_WORKERS } from './coding.js';
import { RESEARCH_BLOCK_IDS, RESEARCH_WORKERS } from './research.js';
import { GENERAL_BLOCK_IDS, GENERAL_WORKERS } from './general.js';

/** Built-in pack ids (v0.4). Unknown custom domains normalize to general on register. */
export const BUILT_IN_PACK_IDS = ['finance', 'coding', 'research', 'general'] as const;
export type BuiltInPackId = (typeof BUILT_IN_PACK_IDS)[number];

const BUILT_IN_PACK_ID_SET = new Set<string>(BUILT_IN_PACK_IDS);

const BUILT_IN_PACKS: DomainPack[] = [
  {
    id: 'finance',
    name: 'Finance',
    description: '시장·리스크·차트·포트폴리오 분석 워커와 금융 블록.',
    workers: FINANCE_WORKERS,
    blockIds: [...FINANCE_BLOCK_IDS],
    icon: 'chart',
    isBuiltIn: true,
  },
  {
    id: 'coding',
    name: 'Coding',
    description: '코드 리뷰·테스트·리팩터·구현 워커와 코딩 블록.',
    workers: CODING_WORKERS,
    blockIds: [...CODING_BLOCK_IDS],
    icon: 'code',
    isBuiltIn: true,
  },
  {
    id: 'research',
    name: 'Research',
    description: '웹 조사와 결과 합성 워커 (v0.4 MVP).',
    workers: RESEARCH_WORKERS,
    blockIds: [...RESEARCH_BLOCK_IDS],
    icon: 'search',
    isBuiltIn: true,
  },
  {
    id: 'general',
    name: 'General',
    description: '범용 솔로 워커와 코디네이터 리더.',
    workers: GENERAL_WORKERS,
    blockIds: [...GENERAL_BLOCK_IDS],
    icon: 'spark',
    isBuiltIn: true,
  },
];

const packRegistry = new Map<string, DomainPack>(
  BUILT_IN_PACKS.map((p) => [p.id, p]),
);

const workerRegistry = new Map<string, DomainWorker>();

function seedWorkersFromPacks(): void {
  for (const pack of packRegistry.values()) {
    for (const w of pack.workers) {
      workerRegistry.set(w.id, w);
    }
  }
}

seedWorkersFromPacks();

/** Cap worker identity / prompt fields in the runtime registry. */
const WORKER_ID_MAX = 200;
const WORKER_NAME_MAX = 200;
const WORKER_DESCRIPTION_MAX = 2_000;
const WORKER_SYSTEM_PROMPT_MAX = 100_000;
const WORKER_TOOLS_MAX = 100;
const WORKER_TOOL_NAME_MAX = 100;

const PERMISSION_PROFILES = new Set<ToolPermissionProfile>([
  'read_only',
  'read_write',
  'execute',
  'network',
  'full',
]);

const WORKER_MODES = new Set<WorkerMode>(['solo', 'coordinator']);

function isSafeId(id: string): boolean {
  return id.length > 0 && id.length <= WORKER_ID_MAX && !/[\0\r\n]/.test(id);
}

function normalizeDomain(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'general';
  const d = raw.trim().toLowerCase() || 'general';
  return BUILT_IN_PACK_ID_SET.has(d) ? d : 'general';
}

function normalizePermissionProfile(raw: unknown): ToolPermissionProfile | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const p = raw.trim().toLowerCase() as ToolPermissionProfile;
  return PERMISSION_PROFILES.has(p) ? p : undefined;
}

function normalizeWorkspace(raw: unknown): WorkspacePolicy | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const kind = (raw as WorkspacePolicy).kind;
  if (kind === 'none' || kind === 'isolated') return { kind };
  if (kind === 'run') {
    const subdir = (raw as { subdir?: unknown }).subdir;
    if (typeof subdir === 'string' && subdir.trim() && !/[\0\r\n]/.test(subdir)) {
      return { kind: 'run', subdir: subdir.trim().slice(0, 200) };
    }
    return { kind: 'run' };
  }
  return undefined;
}

function normalizeDefaultMode(raw: unknown): WorkerMode | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const m = raw.trim().toLowerCase() as WorkerMode;
  return WORKER_MODES.has(m) ? m : undefined;
}

/**
 * Resolve a worker (or legacy harness id) by id.
 * Control-char / blank ids → undefined.
 */
export function resolveWorker(id: string): DomainWorker | undefined {
  if (typeof id !== 'string') return undefined;
  if (/[\0\r\n]/.test(id)) return undefined;
  const trimmed = id.trim();
  if (!isSafeId(trimmed)) return undefined;
  return workerRegistry.get(trimmed);
}

/**
 * List workers, optionally filtered by domain pack id.
 * Control-char / blank domain → list all.
 */
export function listWorkers(domain?: string): DomainWorker[] {
  const domainFilter =
    typeof domain === 'string' && domain.trim() && !/[\0\r\n]/.test(domain)
      ? domain.trim().toLowerCase() || undefined
      : undefined;
  const all = [...workerRegistry.values()];
  return domainFilter ? all.filter((w) => w.domain === domainFilter) : all;
}

/**
 * Register a custom (or test) worker. Built-in id overwrite is allowed in-process
 * for tests; server routes reject built-in mutations separately.
 */
export function registerWorker(worker: DomainWorker): void {
  const idRaw = typeof worker.id === 'string' ? worker.id : '';
  if (!idRaw || /[\0\r\n]/.test(idRaw)) return;
  const id = idRaw.trim();
  if (!isSafeId(id)) return;

  let name = id;
  if (typeof worker.name === 'string' && !/[\0\r\n]/.test(worker.name)) {
    name = worker.name.trim() || id;
  }
  if (name.length > WORKER_NAME_MAX) name = name.slice(0, WORKER_NAME_MAX);

  const domain = normalizeDomain(worker.domain);

  let description: string | undefined;
  if (typeof worker.description === 'string') {
    description = worker.description.replace(/[\0\r\n]/g, ' ').trim();
  } else {
    description = worker.description;
  }
  if (typeof description === 'string' && description.length > WORKER_DESCRIPTION_MAX) {
    description = description.slice(0, WORKER_DESCRIPTION_MAX);
  }

  if (typeof worker.systemPrompt !== 'string' || /[\0\r\n]/.test(worker.systemPrompt)) {
    return;
  }
  let systemPrompt = worker.systemPrompt.trim();
  if (!systemPrompt) return;
  if (systemPrompt.length > WORKER_SYSTEM_PROMPT_MAX) {
    systemPrompt = systemPrompt.slice(0, WORKER_SYSTEM_PROMPT_MAX);
  }

  const allowedTools = Array.isArray(worker.allowedTools)
    ? worker.allowedTools
        .map((t) => String(t ?? ''))
        .filter((t) => t.length > 0 && !/[\0\r\n]/.test(t))
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.length <= WORKER_TOOL_NAME_MAX)
        .slice(0, WORKER_TOOLS_MAX)
    : [];

  const permissionProfile = normalizePermissionProfile(worker.permissionProfile);
  const workspace = normalizeWorkspace(worker.workspace);
  const defaultMode = normalizeDefaultMode(worker.defaultMode);

  const preferredBlockIds = Array.isArray(worker.preferredBlockIds)
    ? worker.preferredBlockIds
        .map((b) => String(b ?? ''))
        .filter((b) => b.length > 0 && !/[\0\r\n]/.test(b))
        .map((b) => b.trim())
        .filter((b) => b.length > 0 && b.length <= WORKER_TOOL_NAME_MAX)
        .slice(0, WORKER_TOOLS_MAX)
    : undefined;

  // Drop raw optional fields so invalid values from `worker` are not re-spread.
  const {
    permissionProfile: _pp,
    workspace: _ws,
    defaultMode: _dm,
    preferredBlockIds: _pb,
    allowedTools: _at,
    id: _id,
    name: _name,
    domain: _domain,
    description: _desc,
    systemPrompt: _sp,
    isBuiltIn: _ib,
    ...rest
  } = worker;

  workerRegistry.set(id, {
    ...rest,
    id,
    name,
    domain,
    description: (description ?? '') as string,
    systemPrompt,
    allowedTools,
    ...(permissionProfile ? { permissionProfile } : {}),
    ...(workspace ? { workspace } : {}),
    ...(defaultMode ? { defaultMode } : {}),
    ...(preferredBlockIds && preferredBlockIds.length > 0 ? { preferredBlockIds } : {}),
    isBuiltIn: worker.isBuiltIn === true,
  });
}

/** List built-in domain packs (custom packs not supported in v0.4). */
export function listPacks(): DomainPack[] {
  return BUILT_IN_PACKS.map((p) => ({
    ...p,
    // Live workers for this pack domain (built-in + custom registered into the domain)
    workers: listWorkers(p.id),
    blockIds: [...p.blockIds],
  }));
}

/**
 * Pack detail by id. Includes custom workers whose domain matches the pack.
 */
export function resolvePack(id: string): DomainPack | undefined {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return undefined;
  const trimmed = id.trim().toLowerCase();
  if (!trimmed) return undefined;
  const base = packRegistry.get(trimmed);
  if (!base) return undefined;
  return {
    ...base,
    workers: listWorkers(trimmed),
    blockIds: [...base.blockIds],
  };
}

/** True when id is a known built-in pack. */
export function isBuiltInPackId(id: string): boolean {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return false;
  const trimmed = id.trim().toLowerCase();
  return trimmed.length > 0 && BUILT_IN_PACK_ID_SET.has(trimmed);
}

// ── Deprecated harness aliases (BC-4 / BC-8) ────────────────

/** @deprecated Use {@link resolveWorker} */
export const resolveHarness = resolveWorker;
/** @deprecated Use {@link listWorkers} */
export const listHarnesses = listWorkers;
/** @deprecated Use {@link registerWorker} */
export const registerHarness = registerWorker;
