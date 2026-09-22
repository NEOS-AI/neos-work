/**
 * Design Systems routes (v0.5.8 — bundled catalog + tokens).
 * GET    /api/design-systems          — list (user + bundled, shadowed)
 * POST   /api/design-systems          — create (user writable)
 * GET    /api/design-systems/:id      — get
 * DELETE /api/design-systems/:id      — delete (user only)
 * GET    /api/design-systems/:id/content  — DESIGN.md raw text
 * PUT    /api/design-systems/:id/content  — save DESIGN.md (user only)
 * GET    /api/design-systems/:id/tokens   — tokens.css raw text
 * PUT    /api/design-systems/:id/tokens   — save tokens.css (user only)
 * GET    /api/design-systems/:id/rules    — RULES.md raw text
 * PUT    /api/design-systems/:id/rules    — save RULES.md (user only)
 * POST   /api/design-systems/:id/rules/append — promote a correction bullet
 * POST   /api/design-systems/:id/rules/prune  — prune stale Corrections
 * GET    /api/design-systems/:id/components   — components.html raw text
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { getPreviewComment } from '../db/projects.js';
import * as store from '../lib/design-system-store.js';
import { publicPathTail, safeRouteId } from '../lib/path-safety.js';

const REPO_DS_CANDIDATE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../design-systems',
);

const designSystems = new Hono();

/** Redact absolute on-disk path before API responses. */
function publicDesignSystem(ds: store.DesignSystem): store.DesignSystem {
  return { ...ds, path: publicPathTail(ds.path) };
}

designSystems.get('/', async (c) => {
  const bundledRoot =
    store.resolveBundledDesignSystemsDir(REPO_DS_CANDIDATE)
    ?? store.resolveBundledDesignSystemsDir(null);
  const list = await store.listDesignSystems({ bundledRoot, includeBundled: true });
  return c.json({ ok: true, data: list.map(publicDesignSystem) });
});

designSystems.post('/', async (c) => {
  const body = await c.req.json<{ name: string; description?: string }>().catch(() => null);
  const nameRaw = typeof body?.name === 'string' ? body.name : '';
  // Control-char check before trim (store also enforces)
  if (/[\0\r\n]/.test(nameRaw)) {
    return c.json({ ok: false, error: 'name contains invalid control characters' }, 400);
  }
  const name = nameRaw.trim();
  let description: string | undefined;
  if (typeof body?.description === 'string') {
    if (/[\0\r\n]/.test(body.description)) {
      return c.json({ ok: false, error: 'description contains invalid control characters' }, 400);
    }
    description = body.description.trim() || undefined;
  }
  if (!name) {
    return c.json({ ok: false, error: 'name is required (alphanumeric, - and _ only)' }, 400);
  }
  const ds = await store.createDesignSystem(name, description);
  if (!ds) {
    return c.json({ ok: false, error: 'Name must be alphanumeric (- and _ allowed) and must not already exist' }, 409);
  }
  return c.json({ ok: true, data: publicDesignSystem(ds) }, 201);
});

function paramDesignId(c: { req: { param: (k: string) => string } }): string {
  // Design system ids are short hashes / safe names (stricter than UUID bound)
  const id = safeRouteId(c.req.param('id'), 64);
  if (!id || /[/\\]/.test(id)) return '';
  return id;
}

designSystems.get('/:id', async (c) => {
  const id = paramDesignId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const ds = await store.getDesignSystem(id);
  if (!ds) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: publicDesignSystem(ds) });
});

designSystems.delete('/:id', async (c) => {
  const id = paramDesignId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const deleted = await store.deleteDesignSystem(id);
  if (!deleted) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

designSystems.get('/:id/content', async (c) => {
  const id = paramDesignId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const content = await store.getDesignSystemContent(id);
  if (content === null) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: { content } });
});

designSystems.put('/:id/content', async (c) => {
  const id = paramDesignId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ content: string }>().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return c.json({ ok: false, error: 'content string required' }, 400);
  }
  // Null bytes break DESIGN.md text files / editors
  if (/\0/.test(body.content)) {
    return c.json({ ok: false, error: 'content contains invalid control characters' }, 400);
  }
  // Reject pure-whitespace so getDesignSystemContent does not treat it as missing later
  if (!body.content.trim()) {
    return c.json({ ok: false, error: 'content cannot be empty' }, 400);
  }
  if (body.content.length > store.DESIGN_MD_MAX_CHARS) {
    return c.json({
      ok: false,
      error: `content exceeds max size (${store.DESIGN_MD_MAX_CHARS} characters)`,
    }, 400);
  }
  const updated = await store.updateDesignSystemContent(id, body.content);
  if (!updated) {
    const ds = await store.getDesignSystem(id);
    if (ds?.source === 'bundled') {
      return c.json({ ok: false, error: 'Bundled design systems are read-only' }, 403);
    }
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  return c.json({ ok: true });
});

designSystems.get('/:id/tokens', async (c) => {
  const id = paramDesignId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const content = await store.getDesignSystemTokens(id);
  if (content === null) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: { content } });
});

designSystems.put('/:id/tokens', async (c) => {
  const id = paramDesignId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ content: string }>().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return c.json({ ok: false, error: 'content string required' }, 400);
  }
  if (/\0/.test(body.content)) {
    return c.json({ ok: false, error: 'content contains invalid control characters' }, 400);
  }
  if (!body.content.trim()) {
    return c.json({ ok: false, error: 'content cannot be empty' }, 400);
  }
  if (body.content.length > store.TOKENS_CSS_MAX_CHARS) {
    return c.json({
      ok: false,
      error: `content exceeds max size (${store.TOKENS_CSS_MAX_CHARS} characters)`,
    }, 400);
  }
  const updated = await store.updateDesignSystemTokens(id, body.content);
  if (!updated) {
    const ds = await store.getDesignSystem(id);
    if (ds?.source === 'bundled') {
      return c.json({ ok: false, error: 'Bundled design systems are read-only' }, 403);
    }
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  return c.json({ ok: true });
});

designSystems.get('/:id/rules', async (c) => {
  const id = paramDesignId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const content = await store.getDesignSystemRules(id);
  if (content === null) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: { content } });
});

designSystems.put('/:id/rules', async (c) => {
  const id = paramDesignId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ content: string }>().catch(() => null);
  if (!body || typeof body.content !== 'string') {
    return c.json({ ok: false, error: 'content string required' }, 400);
  }
  if (/\0/.test(body.content)) {
    return c.json({ ok: false, error: 'content contains invalid control characters' }, 400);
  }
  if (!body.content.trim()) {
    return c.json({ ok: false, error: 'content cannot be empty' }, 400);
  }
  if (body.content.length > store.RULES_MD_MAX_CHARS) {
    return c.json({
      ok: false,
      error: `content exceeds max size (${store.RULES_MD_MAX_CHARS} characters)`,
    }, 400);
  }
  const updated = await store.updateDesignSystemRules(id, body.content);
  if (!updated) {
    const ds = await store.getDesignSystem(id);
    if (ds?.source === 'bundled') {
      return c.json({ ok: false, error: 'Bundled design systems are read-only' }, 403);
    }
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  return c.json({ ok: true });
});

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

designSystems.post('/:id/rules/append', async (c) => {
  const id = paramDesignId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<{ text?: unknown; source?: unknown; commentId?: unknown }>().catch(() => null);
  if (!body || typeof body.text !== 'string') {
    return c.json({ ok: false, error: 'text string required' }, 400);
  }
  if (/\0/.test(body.text)) {
    return c.json({ ok: false, error: 'text contains invalid control characters' }, 400);
  }
  const trimmed = body.text.trim();
  if (!trimmed) {
    return c.json({ ok: false, error: 'text cannot be empty' }, 400);
  }
  if (trimmed.length > store.RULES_APPEND_TEXT_MAX) {
    return c.json({ ok: false, error: 'text exceeds max size (500 characters)' }, 400);
  }
  if (typeof body.commentId === 'string' && body.commentId.trim()) {
    if (!getPreviewComment(body.commentId)) {
      return c.json({ ok: false, error: 'Not found' }, 404);
    }
  }
  const source = typeof body.source === 'string' ? body.source : undefined;
  const updated = await store.appendDesignSystemRules(id, body.text, source);
  if (!updated) {
    const ds = await store.getDesignSystem(id);
    if (ds?.source === 'bundled') {
      return c.json({ ok: false, error: 'Bundled design systems are read-only' }, 403);
    }
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  return c.json({ ok: true });
});

designSystems.post('/:id/rules/prune', async (c) => {
  const id = paramDesignId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    return c.json({ ok: false, error: 'invalid prune options' }, 400);
  }
  const raw = body ?? {};
  let maxEntries: number | undefined;
  let maxAgeDays: number | undefined;
  if ('maxEntries' in raw && raw.maxEntries !== undefined) {
    if (!isIntInRange(raw.maxEntries, store.PRUNE_MAX_ENTRIES_MIN, store.PRUNE_MAX_ENTRIES_MAX)) {
      return c.json({ ok: false, error: 'maxEntries must be an integer from 1 to 100' }, 400);
    }
    maxEntries = raw.maxEntries;
  }
  if ('maxAgeDays' in raw && raw.maxAgeDays !== undefined) {
    if (!isIntInRange(raw.maxAgeDays, store.PRUNE_MAX_AGE_DAYS_MIN, store.PRUNE_MAX_AGE_DAYS_MAX)) {
      return c.json({ ok: false, error: 'maxAgeDays must be an integer from 1 to 365' }, 400);
    }
    maxAgeDays = raw.maxAgeDays;
  }
  const result = await store.pruneDesignSystemRules(id, { maxEntries, maxAgeDays });
  if (!result) {
    const ds = await store.getDesignSystem(id);
    if (ds?.source === 'bundled') {
      return c.json({ ok: false, error: 'Bundled design systems are read-only' }, 403);
    }
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  return c.json({ ok: true, data: { pruned: result.pruned } });
});

designSystems.get('/:id/components', async (c) => {
  const id = paramDesignId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const content = await store.getDesignSystemComponents(id);
  if (content === null) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: { content } });
});

export default designSystems;
