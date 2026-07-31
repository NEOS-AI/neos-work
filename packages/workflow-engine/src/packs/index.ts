/**
 * Domain Pack registry — built-in packs + custom pack loader (v0.4 Task 3 / v0.5 Task 15).
 *
 * Workers are the source of truth. Harness APIs re-export these symbols for
 * v0.3.x / v0.4.x compatibility (`resolveHarness` → `resolveWorker`, etc.).
 *
 * Custom packs: registerPack / unregisterPack / setPackEnabled (manifest → workers + blocks).
 */

import type {
  DomainPack,
  DomainWorker,
  ToolPermissionProfile,
  WorkspacePolicy,
  WorkerMode,
  WorkflowBlock,
} from '@neos-work/shared';
import { registerBlockMeta, unregisterBlockMeta } from '../blocks/registry.js';
import { FINANCE_BLOCK_IDS, FINANCE_WORKERS } from './finance.js';
import { CODING_BLOCK_IDS, CODING_WORKERS } from './coding.js';
import { RESEARCH_BLOCK_IDS, RESEARCH_WORKERS } from './research.js';
import { GENERAL_BLOCK_IDS, GENERAL_WORKERS } from './general.js';
import {
  isSafePackId,
  materializePackFromManifest,
  parsePackManifest,
  type ParsedPackManifest,
} from './manifest.js';

export {
  DOMAIN_PACK_MANIFEST_SCHEMA,
  isSafePackId,
  materializePackFromManifest,
  parsePackManifest,
  PACK_MANIFEST_FILENAMES,
} from './manifest.js';
export type {
  PackManifestBlock,
  PackManifestWorker,
  ParsedPackManifest,
  ParsePackManifestResult,
} from './manifest.js';

/** Built-in pack ids (v0.4). Unknown custom domains normalize to general on ad-hoc registerWorker. */
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
    enabled: true,
  },
  {
    id: 'coding',
    name: 'Coding',
    description: '코드 리뷰·테스트·리팩터·구현 워커와 코딩 블록.',
    workers: CODING_WORKERS,
    blockIds: [...CODING_BLOCK_IDS],
    icon: 'code',
    isBuiltIn: true,
    enabled: true,
  },
  {
    id: 'research',
    name: 'Research',
    description: '웹 조사와 결과 합성 워커 (v0.4 MVP).',
    workers: RESEARCH_WORKERS,
    blockIds: [...RESEARCH_BLOCK_IDS],
    icon: 'search',
    isBuiltIn: true,
    enabled: true,
  },
  {
    id: 'general',
    name: 'General',
    description: '범용 솔로 워커와 코디네이터 리더.',
    workers: GENERAL_WORKERS,
    blockIds: [...GENERAL_BLOCK_IDS],
    icon: 'spark',
    isBuiltIn: true,
    enabled: true,
  },
];

const packRegistry = new Map<string, DomainPack>(
  BUILT_IN_PACKS.map((p) => [p.id, p]),
);

/** Worker ids owned by a custom pack (for clean unregister). */
const packOwnedWorkers = new Map<string, string[]>();
/** Block ids owned by a custom pack. */
const packOwnedBlocks = new Map<string, string[]>();
/** Full block meta snapshots (for re-enable after disable). */
const packOwnedBlockMeta = new Map<string, WorkflowBlock[]>();

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

/**
 * Normalize worker domain for ad-hoc registerWorker.
 * Built-in + currently registered custom pack ids are kept; unknown → general.
 * When `forcePackId` is set (registerPack path), that id is used if safe.
 */
function normalizeDomain(raw: unknown, forcePackId?: string): string {
  if (forcePackId && isSafePackId(forcePackId) && packRegistry.has(forcePackId)) {
    return forcePackId;
  }
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'general';
  const d = raw.trim().toLowerCase() || 'general';
  if (BUILT_IN_PACK_ID_SET.has(d)) return d;
  if (packRegistry.has(d)) return d;
  return 'general';
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
 * @param opts.forceDomain — when registering via pack, force worker.domain = pack id
 */
export function registerWorker(
  worker: DomainWorker,
  opts?: { forceDomain?: string },
): void {
  const idRaw = typeof worker.id === 'string' ? worker.id : '';
  if (!idRaw || /[\0\r\n]/.test(idRaw)) return;
  const id = idRaw.trim();
  if (!isSafeId(id)) return;

  let name = id;
  if (typeof worker.name === 'string' && !/[\0\r\n]/.test(worker.name)) {
    name = worker.name.trim() || id;
  }
  if (name.length > WORKER_NAME_MAX) name = name.slice(0, WORKER_NAME_MAX);

  const domain = normalizeDomain(worker.domain, opts?.forceDomain);

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

/**
 * Remove a custom (non-built-in) worker from the runtime registry.
 * Built-in ids are never removed. Returns true when an entry was deleted.
 */
export function unregisterWorker(id: string): boolean {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return false;
  const trimmed = id.trim();
  if (!isSafeId(trimmed)) return false;
  const existing = workerRegistry.get(trimmed);
  if (!existing || existing.isBuiltIn === true) return false;
  return workerRegistry.delete(trimmed);
}

/** List built-in + custom domain packs. */
export function listPacks(): DomainPack[] {
  return [...packRegistry.values()].map((p) => ({
    ...p,
    // Live workers for this pack domain (built-in + custom registered into the domain)
    workers: listWorkers(p.id),
    blockIds: [...p.blockIds],
    enabled: p.enabled !== false,
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
    enabled: base.enabled !== false,
  };
}

/** True when id is a known built-in pack. */
export function isBuiltInPackId(id: string): boolean {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return false;
  const trimmed = id.trim().toLowerCase();
  return trimmed.length > 0 && BUILT_IN_PACK_ID_SET.has(trimmed);
}

/** True when id is registered (built-in or custom). */
export function isRegisteredPackId(id: string): boolean {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return false;
  const trimmed = id.trim().toLowerCase();
  return trimmed.length > 0 && packRegistry.has(trimmed);
}

export type RegisterPackResult =
  | { ok: true; pack: DomainPack }
  | { ok: false; error: string };

/**
 * Register a custom Domain Pack from a parsed manifest (or pre-materialized pieces).
 * Replaces any previous custom pack with the same id. Built-in ids are rejected.
 */
export function registerPack(
  input:
    | ParsedPackManifest
    | {
        pack: DomainPack;
        workers: DomainWorker[];
        blocks: WorkflowBlock[];
      },
  opts?: { enabled?: boolean; sourcePath?: string },
): RegisterPackResult {
  let pack: DomainPack;
  let workers: DomainWorker[];
  let blocks: WorkflowBlock[];

  // Discriminate: materialized form has `.pack`; manifest form has top-level workers/blocks
  if (
    input
    && typeof input === 'object'
    && 'pack' in input
    && (input as { pack?: unknown }).pack
    && typeof (input as { pack: unknown }).pack === 'object'
  ) {
    const body = input as {
      pack: DomainPack;
      workers: DomainWorker[];
      blocks: WorkflowBlock[];
    };
    pack = {
      ...body.pack,
      isBuiltIn: false,
      enabled: opts?.enabled !== false && body.pack.enabled !== false,
      ...(opts?.sourcePath ? { sourcePath: opts.sourcePath } : {}),
    };
    workers = body.workers ?? [];
    blocks = body.blocks ?? [];
  } else {
    const mat = materializePackFromManifest(input as ParsedPackManifest, opts);
    pack = mat.pack;
    workers = mat.workers;
    blocks = mat.blocks;
  }

  if (!isSafePackId(pack.id)) {
    return { ok: false, error: 'invalid pack id' };
  }
  if (BUILT_IN_PACK_ID_SET.has(pack.id)) {
    return { ok: false, error: `id "${pack.id}" is reserved for a built-in pack` };
  }

  // Replace previous custom pack with same id
  if (packRegistry.has(pack.id) && !isBuiltInPackId(pack.id)) {
    unregisterPack(pack.id);
  }

  const enabled = pack.enabled !== false;
  const stored: DomainPack = {
    ...pack,
    isBuiltIn: false,
    enabled,
    workers: [], // live workers filled via listWorkers
    blockIds: blocks.map((b) => b.id),
  };
  packRegistry.set(pack.id, stored);

  const ownedWorkers: string[] = [];
  const ownedBlocks: string[] = [];

  if (enabled) {
    for (const w of workers) {
      registerWorker(
        { ...w, domain: pack.id, isBuiltIn: false },
        { forceDomain: pack.id },
      );
      if (resolveWorker(w.id)) ownedWorkers.push(w.id);
    }
    for (const b of blocks) {
      registerBlockMeta({
        ...b,
        domain: pack.id,
        isBuiltIn: false,
      });
      ownedBlocks.push(b.id);
    }
  }

  packOwnedWorkers.set(pack.id, ownedWorkers);
  packOwnedBlocks.set(pack.id, ownedBlocks);
  packOwnedBlockMeta.set(
    pack.id,
    blocks.map((b) => ({ ...b, domain: pack.id, isBuiltIn: false })),
  );

  // Refresh stored blockIds even when disabled
  stored.blockIds = blocks.map((b) => b.id);
  stored.workers = workers.map((w) => ({ ...w, domain: pack.id, isBuiltIn: false }));

  return { ok: true, pack: resolvePack(pack.id)! };
}

/**
 * Remove a custom pack and its owned workers/blocks from the runtime registry.
 * Built-in packs cannot be removed. Returns true when removed.
 */
export function unregisterPack(id: string): boolean {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return false;
  const trimmed = id.trim().toLowerCase();
  if (!trimmed || BUILT_IN_PACK_ID_SET.has(trimmed)) return false;
  const existing = packRegistry.get(trimmed);
  if (!existing || existing.isBuiltIn) return false;

  const workers = packOwnedWorkers.get(trimmed) ?? [];
  for (const wid of workers) {
    unregisterWorker(wid);
  }
  packOwnedWorkers.delete(trimmed);

  const blocks = packOwnedBlocks.get(trimmed) ?? [];
  for (const bid of blocks) {
    unregisterBlockMeta(bid);
  }
  packOwnedBlocks.delete(trimmed);
  packOwnedBlockMeta.delete(trimmed);

  return packRegistry.delete(trimmed);
}

/**
 * Enable or disable a custom pack in-process.
 * Disable unregisters workers/blocks but keeps the pack entry; enable re-registers.
 * Built-in packs always stay enabled.
 */
export function setPackEnabled(id: string, enabled: boolean): RegisterPackResult {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) {
    return { ok: false, error: 'invalid pack id' };
  }
  const trimmed = id.trim().toLowerCase();
  if (BUILT_IN_PACK_ID_SET.has(trimmed)) {
    return { ok: false, error: 'cannot disable a built-in pack' };
  }
  const existing = packRegistry.get(trimmed);
  if (!existing || existing.isBuiltIn) {
    return { ok: false, error: 'pack not found' };
  }

  if (enabled === (existing.enabled !== false)) {
    return { ok: true, pack: resolvePack(trimmed)! };
  }

  // Snapshot definition before unregister
  const workersSnap = [...(existing.workers ?? [])];
  const blockIdsSnap = [...existing.blockIds];
  const sourcePath = existing.sourcePath;
  const version = existing.version;
  const icon = existing.icon;
  const name = existing.name;
  const description = existing.description;

  if (!enabled) {
    // Drop runtime workers/blocks, keep pack shell
    const workers = packOwnedWorkers.get(trimmed) ?? [];
    for (const wid of workers) unregisterWorker(wid);
    packOwnedWorkers.set(trimmed, []);
    const blocks = packOwnedBlocks.get(trimmed) ?? [];
    for (const bid of blocks) unregisterBlockMeta(bid);
    packOwnedBlocks.set(trimmed, []);
    packRegistry.set(trimmed, {
      ...existing,
      enabled: false,
      workers: workersSnap,
      blockIds: blockIdsSnap,
    });
    return { ok: true, pack: resolvePack(trimmed)! };
  }

  // Re-enable: re-register from stored worker + block definitions
  const ownedWorkers: string[] = [];
  for (const w of workersSnap) {
    registerWorker(
      { ...w, domain: trimmed, isBuiltIn: false },
      { forceDomain: trimmed },
    );
    if (resolveWorker(w.id)) ownedWorkers.push(w.id);
  }
  packOwnedWorkers.set(trimmed, ownedWorkers);

  const blockMetas = packOwnedBlockMeta.get(trimmed) ?? [];
  const ownedBlocks: string[] = [];
  for (const b of blockMetas) {
    registerBlockMeta({ ...b, domain: trimmed, isBuiltIn: false });
    ownedBlocks.push(b.id);
  }
  packOwnedBlocks.set(trimmed, ownedBlocks);

  packRegistry.set(trimmed, {
    id: trimmed,
    name,
    description,
    workers: workersSnap,
    blockIds: blockIdsSnap,
    ...(icon ? { icon } : {}),
    isBuiltIn: false,
    enabled: true,
    ...(version ? { version } : {}),
    ...(sourcePath ? { sourcePath } : {}),
  });
  return { ok: true, pack: resolvePack(trimmed)! };
}

/**
 * Register pack from raw JSON/object (convenience for tests + loaders).
 */
export function registerPackFromManifest(
  raw: unknown,
  opts?: { enabled?: boolean; sourcePath?: string },
): RegisterPackResult {
  const parsed = parsePackManifest(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return registerPack(parsed.manifest, opts);
}

// ── Deprecated harness aliases (BC-4 / BC-8) ────────────────

/** @deprecated Use {@link resolveWorker} */
export const resolveHarness = resolveWorker;
/** @deprecated Use {@link listWorkers} */
export const listHarnesses = listWorkers;
/** @deprecated Use {@link registerWorker} */
export const registerHarness = registerWorker;
/** @deprecated Use {@link unregisterWorker} */
export const unregisterHarness = unregisterWorker;
