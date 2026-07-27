/**
 * Domain Worker REST routes (v0.4 Task 7).
 * GET    /api/workers        — list (built-in + custom); ?domain=
 * GET    /api/workers/:id
 * POST   /api/workers        — create custom worker
 * PUT    /api/workers/:id    — update custom (built-in: 403)
 * DELETE /api/workers/:id    — delete custom (built-in: 403)
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import {
  listWorkers,
  resolveWorker,
  registerWorker,
} from '@neos-work/workflow-engine';
import type { DomainWorker, ToolPermissionProfile, WorkerMode, WorkspacePolicy } from '@neos-work/shared';
import * as db from '../db/workers.js';
import { safeRouteId } from '../lib/path-safety.js';
import { publicErrorMessage } from '../lib/errors.js';

const workers = new Hono();

function paramWorkerId(c: { req: { param: (k: string) => string } }): string {
  return safeRouteId(c.req.param('id'));
}

function normalizeConstraints(
  raw: { maxSteps?: number; maxTokens?: number; timeoutMs?: number; maxSpawnedWorkers?: number } | undefined,
): DomainWorker['constraints'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: NonNullable<DomainWorker['constraints']> = {};
  if (raw.maxSteps !== undefined) {
    const n = Number(raw.maxSteps);
    if (Number.isFinite(n) && n >= 1) out.maxSteps = Math.min(200, Math.floor(n));
  }
  if (raw.maxTokens !== undefined) {
    const n = Number(raw.maxTokens);
    if (Number.isFinite(n) && n >= 1) out.maxTokens = Math.min(1_000_000, Math.floor(n));
  }
  if (raw.timeoutMs !== undefined) {
    const n = Number(raw.timeoutMs);
    if (Number.isFinite(n) && n >= 1) out.timeoutMs = Math.min(3_600_000, Math.floor(n));
  }
  if (raw.maxSpawnedWorkers !== undefined) {
    const n = Number(raw.maxSpawnedWorkers);
    if (Number.isFinite(n) && n >= 1) out.maxSpawnedWorkers = Math.min(8, Math.floor(n));
  }
  return out;
}

function normalizeAllowedTools(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((t) => {
      const s = typeof t === 'string' ? t : String(t ?? '');
      if (/[\0\r\n]/.test(s)) return '';
      return s.trim();
    })
    .filter((t) => t.length > 0 && t.length <= 100)
    .slice(0, 100);
}

const DOMAINS = new Set(['finance', 'coding', 'research', 'general']);
const PROFILES = new Set(['read_only', 'read_write', 'execute', 'network', 'full']);
const MODES = new Set(['solo', 'coordinator']);

function normalizeDomain(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'general';
  const d = raw.trim().toLowerCase() || 'general';
  return DOMAINS.has(d) ? d : 'general';
}

function normalizeProfile(raw: unknown): ToolPermissionProfile | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const p = raw.trim().toLowerCase();
  return PROFILES.has(p) ? (p as ToolPermissionProfile) : undefined;
}

function normalizeMode(raw: unknown): WorkerMode | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const m = raw.trim().toLowerCase();
  return MODES.has(m) ? (m as WorkerMode) : undefined;
}

function normalizeWorkspace(raw: unknown): WorkspacePolicy | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
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

/** Merge built-in + custom workers (custom wins on id collision). */
function mergedWorkers(domain?: string): DomainWorker[] {
  const all = listWorkers(domain);
  const custom = db.listCustomWorkers(domain);
  const map = new Map(all.map((w) => [w.id, w]));
  for (const w of custom) map.set(w.id, w);
  return [...map.values()];
}

workers.get('/', (c) => {
  const domainRaw = c.req.query('domain');
  const domain =
    typeof domainRaw === 'string' && domainRaw.trim() && !/[\0\r\n]/.test(domainRaw)
      ? domainRaw.trim().toLowerCase()
      : undefined;
  return c.json({ ok: true, data: mergedWorkers(domain) });
});

workers.get('/:id', (c) => {
  const id = paramWorkerId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);

  const custom = db.getCustomWorker(id);
  if (custom) return c.json({ ok: true, data: custom });

  const builtin = resolveWorker(id);
  if (builtin) return c.json({ ok: true, data: builtin });

  return c.json({ ok: false, error: 'Not found' }, 404);
});

workers.post('/', async (c) => {
  const body = await c.req.json<{
    name: string;
    domain: string;
    description: string;
    systemPrompt: string;
    allowedTools: string[];
    constraints?: DomainWorker['constraints'];
    permissionProfile?: string;
    workspace?: WorkspacePolicy;
    defaultMode?: string;
  }>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.name !== 'string' || /[\0\r\n]/.test(body.name)) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }
  if (typeof body.systemPrompt !== 'string' || /\0/.test(body.systemPrompt)) {
    return c.json({ ok: false, error: 'name and systemPrompt are required' }, 400);
  }
  const name = body.name.trim();
  const systemPrompt = body.systemPrompt.trim();
  if (!name || !systemPrompt) {
    return c.json({ ok: false, error: 'name and systemPrompt are required' }, 400);
  }
  if (name.length > 200) {
    return c.json({ ok: false, error: 'Invalid name' }, 400);
  }

  if (!Array.isArray(body.allowedTools)) {
    return c.json({ ok: false, error: 'allowedTools must be an array' }, 400);
  }
  const allowedTools = normalizeAllowedTools(body.allowedTools) ?? [];

  let description = '';
  if (typeof body.description === 'string') {
    if (/\0/.test(body.description)) {
      return c.json({ ok: false, error: 'Invalid description' }, 400);
    }
    description = body.description.trim();
  }

  try {
    const created = db.createCustomWorker({
      id: nanoid(12),
      name,
      domain: normalizeDomain(body.domain),
      description,
      systemPrompt,
      allowedTools,
      constraints: normalizeConstraints(body.constraints),
      permissionProfile: normalizeProfile(body.permissionProfile) ?? 'full',
      workspace: normalizeWorkspace(body.workspace),
      defaultMode: normalizeMode(body.defaultMode) ?? 'solo',
    });
    registerWorker(created);
    return c.json({ ok: true, data: created }, 201);
  } catch (err) {
    const msg = publicErrorMessage(err, 'Failed to create worker');
    return c.json({ ok: false, error: msg }, 400);
  }
});

workers.put('/:id', async (c) => {
  const id = paramWorkerId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);

  if (resolveWorker(id)?.isBuiltIn) {
    return c.json({ ok: false, error: 'Cannot modify built-in worker' }, 403);
  }

  const body = await c.req.json<Partial<{
    name: string;
    domain: string;
    description: string;
    systemPrompt: string;
    allowedTools: string[];
    constraints: object;
    permissionProfile: string;
    workspace: WorkspacePolicy;
    defaultMode: string;
  }>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const patch: Partial<DomainWorker> = {};
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || /[\0\r\n]/.test(body.name)) {
      return c.json({ ok: false, error: 'Invalid name' }, 400);
    }
    const name = body.name.trim();
    if (!name) return c.json({ ok: false, error: 'name is required' }, 400);
    if (name.length > 200) return c.json({ ok: false, error: 'Invalid name' }, 400);
    patch.name = name;
  }
  if (body.systemPrompt !== undefined) {
    if (typeof body.systemPrompt !== 'string' || /\0/.test(body.systemPrompt)) {
      return c.json({ ok: false, error: 'systemPrompt is required' }, 400);
    }
    const systemPrompt = body.systemPrompt.trim();
    if (!systemPrompt) return c.json({ ok: false, error: 'systemPrompt is required' }, 400);
    patch.systemPrompt = systemPrompt;
  }
  if (typeof body.description === 'string') {
    if (/\0/.test(body.description)) {
      return c.json({ ok: false, error: 'Invalid description' }, 400);
    }
    patch.description = body.description.trim();
  }
  if (typeof body.domain === 'string') {
    patch.domain = normalizeDomain(body.domain);
  }
  if (body.allowedTools !== undefined) {
    if (!Array.isArray(body.allowedTools)) {
      return c.json({ ok: false, error: 'allowedTools must be an array' }, 400);
    }
    patch.allowedTools = normalizeAllowedTools(body.allowedTools) ?? [];
  }
  if (body.constraints !== undefined) {
    patch.constraints = normalizeConstraints(
      body.constraints as DomainWorker['constraints'],
    );
  }
  if (body.permissionProfile !== undefined) {
    patch.permissionProfile = normalizeProfile(body.permissionProfile) ?? 'full';
  }
  if (body.workspace !== undefined) {
    patch.workspace = normalizeWorkspace(body.workspace);
  }
  if (body.defaultMode !== undefined) {
    patch.defaultMode = normalizeMode(body.defaultMode) ?? 'solo';
  }

  const updated = db.updateCustomWorker(id, patch);
  if (!updated) return c.json({ ok: false, error: 'Not found' }, 404);
  registerWorker(updated);
  return c.json({ ok: true, data: updated });
});

workers.delete('/:id', (c) => {
  const id = paramWorkerId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);

  if (resolveWorker(id)?.isBuiltIn) {
    return c.json({ ok: false, error: 'Cannot delete built-in worker' }, 403);
  }

  const deleted = db.deleteCustomWorker(id);
  if (!deleted) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export default workers;
