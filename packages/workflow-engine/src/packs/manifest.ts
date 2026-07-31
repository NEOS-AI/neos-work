/**
 * Domain Pack manifest schema + parser (PLAN_FOR_V0_5_0 Task 15).
 *
 * File: pack.json (or neos-pack.json) with schema "neos-domain-pack/v1".
 * Custom packs may only declare prompt/skill blocks (no native executors).
 */

import {
  DOMAIN_PACK_MANIFEST_SCHEMA,
  type DomainPack,
  type DomainWorker,
  type ToolPermissionProfile,
  type WorkerMode,
  type WorkflowBlock,
  type WorkspacePolicy,
} from '@neos-work/shared';

export { DOMAIN_PACK_MANIFEST_SCHEMA };

export const PACK_MANIFEST_FILENAMES = ['pack.json', 'neos-pack.json'] as const;

export const PACK_ID_MAX = 64;
export const PACK_NAME_MAX = 200;
export const PACK_DESCRIPTION_MAX = 4_000;
export const PACK_VERSION_MAX = 40;
export const PACK_ICON_MAX = 40;
export const PACK_WORKERS_MAX = 50;
export const PACK_BLOCKS_MAX = 50;

const PERMISSION_PROFILES = new Set<ToolPermissionProfile>([
  'read_only',
  'read_write',
  'execute',
  'network',
  'full',
]);
const WORKER_MODES = new Set<WorkerMode>(['solo', 'coordinator']);
const IMPLEMENTATION_TYPES = new Set(['prompt', 'skill']);

/** Safe pack / domain id: lowercase slug. */
export function isSafePackId(id: string): boolean {
  return (
    typeof id === 'string'
    && id.length > 0
    && id.length <= PACK_ID_MAX
    && !/[\0\r\n]/.test(id)
    && /^[a-z][a-z0-9_-]*$/.test(id)
  );
}

export interface PackManifestWorker {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  allowedTools?: string[];
  permissionProfile?: ToolPermissionProfile;
  workspace?: WorkspacePolicy;
  defaultMode?: WorkerMode;
  preferredBlockIds?: string[];
}

export interface PackManifestBlock {
  id: string;
  name: string;
  category?: string;
  description?: string;
  implementationType: 'prompt' | 'skill';
  promptTemplate?: string;
  skillId?: string;
  paramDefs?: WorkflowBlock['paramDefs'];
  inputDescription?: string;
  outputDescription?: string;
}

export interface ParsedPackManifest {
  schema: typeof DOMAIN_PACK_MANIFEST_SCHEMA;
  id: string;
  name: string;
  description: string;
  version?: string;
  icon?: string;
  workers: PackManifestWorker[];
  blocks: PackManifestBlock[];
}

export type ParsePackManifestResult =
  | { ok: true; manifest: ParsedPackManifest }
  | { ok: false; error: string };

function asTrimmedString(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) : t;
}

function asMultilineString(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string' || /\0/.test(raw)) return undefined;
  // Allow newlines inside prompts; reject null bytes
  const t = raw.trim();
  if (!t) return undefined;
  return t.length > max ? t.slice(0, max) : t;
}

function normalizePermissionProfile(raw: unknown): ToolPermissionProfile | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const p = raw.trim().toLowerCase() as ToolPermissionProfile;
  return PERMISSION_PROFILES.has(p) ? p : undefined;
}

function normalizeDefaultMode(raw: unknown): WorkerMode | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const m = raw.trim().toLowerCase() as WorkerMode;
  return WORKER_MODES.has(m) ? m : undefined;
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

function parseWorker(raw: unknown, packId: string, index: number): PackManifestWorker | string {
  if (!raw || typeof raw !== 'object') return `workers[${index}]: must be object`;
  const w = raw as Record<string, unknown>;
  const idRaw = asTrimmedString(w.id, 200);
  if (!idRaw || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(idRaw)) {
    return `workers[${index}]: invalid id`;
  }
  const name = asTrimmedString(w.name, 200) ?? idRaw;
  const systemPrompt = asMultilineString(w.systemPrompt, 100_000);
  if (!systemPrompt) return `workers[${index}]: systemPrompt required`;
  const description = asMultilineString(w.description, 2_000);
  const allowedTools = Array.isArray(w.allowedTools)
    ? w.allowedTools
        .map((t) => (typeof t === 'string' && !/[\0\r\n]/.test(t) ? t.trim() : ''))
        .filter((t) => t.length > 0 && t.length <= 100)
        .slice(0, 100)
    : undefined;
  const preferredBlockIds = Array.isArray(w.preferredBlockIds)
    ? w.preferredBlockIds
        .map((t) => (typeof t === 'string' && !/[\0\r\n]/.test(t) ? t.trim() : ''))
        .filter((t) => t.length > 0 && t.length <= 100)
        .slice(0, 100)
    : undefined;
  void packId;
  return {
    id: idRaw,
    name,
    ...(description ? { description } : {}),
    systemPrompt,
    ...(allowedTools && allowedTools.length > 0 ? { allowedTools } : {}),
    ...(normalizePermissionProfile(w.permissionProfile)
      ? { permissionProfile: normalizePermissionProfile(w.permissionProfile) }
      : {}),
    ...(normalizeWorkspace(w.workspace) ? { workspace: normalizeWorkspace(w.workspace) } : {}),
    ...(normalizeDefaultMode(w.defaultMode)
      ? { defaultMode: normalizeDefaultMode(w.defaultMode) }
      : {}),
    ...(preferredBlockIds && preferredBlockIds.length > 0 ? { preferredBlockIds } : {}),
  };
}

function parseBlock(raw: unknown, index: number): PackManifestBlock | string {
  if (!raw || typeof raw !== 'object') return `blocks[${index}]: must be object`;
  const b = raw as Record<string, unknown>;
  const idRaw = asTrimmedString(b.id, 200);
  if (!idRaw || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(idRaw)) {
    return `blocks[${index}]: invalid id`;
  }
  const name = asTrimmedString(b.name, 200) ?? idRaw;
  const implRaw =
    typeof b.implementationType === 'string' && !/[\0\r\n]/.test(b.implementationType)
      ? b.implementationType.trim().toLowerCase()
      : 'prompt';
  // Reject native — custom packs cannot ship native executors
  if (implRaw === 'native') {
    return `blocks[${index}]: native implementationType not allowed in pack manifests`;
  }
  if (!IMPLEMENTATION_TYPES.has(implRaw)) {
    return `blocks[${index}]: implementationType must be prompt or skill`;
  }
  const implementationType = implRaw as 'prompt' | 'skill';
  const description = asMultilineString(b.description, 2_000);
  const category = asTrimmedString(b.category, 100) ?? 'custom';
  const promptTemplate = asMultilineString(b.promptTemplate, 50_000);
  const skillId = asTrimmedString(b.skillId, 200);
  if (implementationType === 'prompt' && !promptTemplate) {
    return `blocks[${index}]: promptTemplate required for prompt blocks`;
  }
  if (implementationType === 'skill' && !skillId) {
    return `blocks[${index}]: skillId required for skill blocks`;
  }
  return {
    id: idRaw,
    name,
    category,
    ...(description ? { description } : {}),
    implementationType,
    ...(promptTemplate ? { promptTemplate } : {}),
    ...(skillId ? { skillId } : {}),
    inputDescription: asTrimmedString(b.inputDescription, 500) ?? '',
    outputDescription: asTrimmedString(b.outputDescription, 500) ?? '',
  };
}

/**
 * Parse and validate a domain pack manifest object (or JSON string).
 * Rejects invalid schema, ids, empty workers+blocks, native blocks, control chars.
 */
export function parsePackManifest(raw: unknown): ParsePackManifestResult {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    if (/\0/.test(raw) || raw.length > 2_000_000) {
      return { ok: false, error: 'manifest too large or contains null bytes' };
    }
    try {
      obj = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: 'manifest is not valid JSON' };
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'manifest must be a JSON object' };
  }
  const m = obj as Record<string, unknown>;

  const schema = asTrimmedString(m.schema, 80) ?? asTrimmedString(m.$schema, 80);
  if (schema !== DOMAIN_PACK_MANIFEST_SCHEMA) {
    return {
      ok: false,
      error: `schema must be "${DOMAIN_PACK_MANIFEST_SCHEMA}" (got ${schema ?? 'missing'})`,
    };
  }

  const id = asTrimmedString(m.id, PACK_ID_MAX);
  if (!id || !isSafePackId(id)) {
    return { ok: false, error: 'id must be a lowercase slug [a-z][a-z0-9_-]*' };
  }

  // Reserved built-in ids cannot be claimed by custom manifests at parse time
  // (install layer also rejects; fail fast here for clarity)
  const BUILT_INS = new Set(['finance', 'coding', 'research', 'general']);
  if (BUILT_INS.has(id)) {
    return { ok: false, error: `id "${id}" is reserved for a built-in pack` };
  }

  const name = asTrimmedString(m.name, PACK_NAME_MAX) ?? id;
  const description = asMultilineString(m.description, PACK_DESCRIPTION_MAX) ?? '';
  const version = asTrimmedString(m.version, PACK_VERSION_MAX);
  const icon = asTrimmedString(m.icon, PACK_ICON_MAX);

  const workersRaw = m.workers;
  const blocksRaw = m.blocks;
  if (workersRaw !== undefined && !Array.isArray(workersRaw)) {
    return { ok: false, error: 'workers must be an array' };
  }
  if (blocksRaw !== undefined && !Array.isArray(blocksRaw)) {
    return { ok: false, error: 'blocks must be an array' };
  }

  const workers: PackManifestWorker[] = [];
  if (Array.isArray(workersRaw)) {
    if (workersRaw.length > PACK_WORKERS_MAX) {
      return { ok: false, error: `workers exceeds max ${PACK_WORKERS_MAX}` };
    }
    const seen = new Set<string>();
    for (let i = 0; i < workersRaw.length; i++) {
      const parsed = parseWorker(workersRaw[i], id, i);
      if (typeof parsed === 'string') return { ok: false, error: parsed };
      if (seen.has(parsed.id)) {
        return { ok: false, error: `duplicate worker id "${parsed.id}"` };
      }
      seen.add(parsed.id);
      workers.push(parsed);
    }
  }

  const blocks: PackManifestBlock[] = [];
  if (Array.isArray(blocksRaw)) {
    if (blocksRaw.length > PACK_BLOCKS_MAX) {
      return { ok: false, error: `blocks exceeds max ${PACK_BLOCKS_MAX}` };
    }
    const seen = new Set<string>();
    for (let i = 0; i < blocksRaw.length; i++) {
      const parsed = parseBlock(blocksRaw[i], i);
      if (typeof parsed === 'string') return { ok: false, error: parsed };
      if (seen.has(parsed.id)) {
        return { ok: false, error: `duplicate block id "${parsed.id}"` };
      }
      seen.add(parsed.id);
      blocks.push(parsed);
    }
  }

  if (workers.length === 0 && blocks.length === 0) {
    return { ok: false, error: 'pack must declare at least one worker or block' };
  }

  return {
    ok: true,
    manifest: {
      schema: DOMAIN_PACK_MANIFEST_SCHEMA,
      id,
      name,
      description,
      ...(version ? { version } : {}),
      ...(icon ? { icon } : {}),
      workers,
      blocks,
    },
  };
}

/** Convert a parsed manifest into DomainWorker[] / WorkflowBlock[] / DomainPack shape. */
export function materializePackFromManifest(
  manifest: ParsedPackManifest,
  opts?: { enabled?: boolean; sourcePath?: string },
): {
  pack: DomainPack;
  workers: DomainWorker[];
  blocks: WorkflowBlock[];
} {
  const enabled = opts?.enabled !== false;
  const workers: DomainWorker[] = manifest.workers.map((w) => ({
    id: w.id,
    name: w.name,
    domain: manifest.id,
    description: w.description ?? '',
    systemPrompt: w.systemPrompt,
    allowedTools: w.allowedTools ?? [],
    ...(w.permissionProfile ? { permissionProfile: w.permissionProfile } : {}),
    ...(w.workspace ? { workspace: w.workspace } : {}),
    ...(w.defaultMode ? { defaultMode: w.defaultMode } : {}),
    ...(w.preferredBlockIds ? { preferredBlockIds: w.preferredBlockIds } : {}),
    isBuiltIn: false,
  }));

  const blocks: WorkflowBlock[] = manifest.blocks.map((b) => ({
    id: b.id,
    name: b.name,
    domain: manifest.id,
    category: b.category ?? 'custom',
    description: b.description ?? '',
    isBuiltIn: false,
    implementationType: b.implementationType,
    paramDefs: b.paramDefs ?? [],
    inputDescription: b.inputDescription ?? '',
    outputDescription: b.outputDescription ?? '',
    ...(b.promptTemplate ? { promptTemplate: b.promptTemplate } : {}),
    ...(b.skillId ? { skillId: b.skillId } : {}),
  }));

  const pack: DomainPack = {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    workers,
    blockIds: blocks.map((b) => b.id),
    ...(manifest.icon ? { icon: manifest.icon } : {}),
    isBuiltIn: false,
    ...(manifest.version ? { version: manifest.version } : {}),
    enabled,
    ...(opts?.sourcePath ? { sourcePath: opts.sourcePath } : {}),
  };

  return { pack, workers, blocks };
}
