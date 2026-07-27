/**
 * Project / agent run API (v0.5.10 — DS + memory + comment inject, CLI execute).
 *
 * POST   /api/runs              — create + start (background CLI when agentId set)
 * GET    /api/runs              — list (?projectId=)
 * GET    /api/runs/:id          — get run
 * GET    /api/runs/:id/events   — events (?after=eventId)
 * GET    /api/runs/:id/events/stream — SSE of new events
 * POST   /api/runs/:id/cancel   — cancel
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import {
  assembleDesignContextPrompt,
  assembleEditContextPrompt,
  assemblePreviewCommentsPrompt,
  getDefById,
  getGlobalRunRegistry,
} from '@neos-work/agent-runtime';
import { normalizeEditContext } from '@neos-work/shared';
import { safeRouteId } from '../lib/path-safety.js';
import { publicErrorMessage } from '../lib/errors.js';
import { getProject, listPreviewComments } from '../db/projects.js';
import {
  getDesignSystem,
  getDesignSystemContent,
  getDesignSystemTokens,
} from '../lib/design-system-store.js';
import { spawnRegistryAgent } from '../lib/registry-spawn.js';
import { getRuntimeAuthToken, getRuntimeServerUrl } from '../lib/runtime-context.js';
import { listProjectFiles } from '../lib/project-files.js';
import { exportMemories } from '../lib/memory-store.js';

const runs = new Hono();

function paramId(c: { req: { param: (k: string) => string } }, key = 'id'): string {
  return safeRouteId(c.req.param(key));
}

function publicRun(record: {
  id: string;
  status: string;
  agentId?: string | null;
  projectId?: string | null;
  prompt?: string;
  editContext?: unknown;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  events: unknown[];
}) {
  return {
    id: record.id,
    status: record.status,
    agentId: record.agentId ?? null,
    projectId: record.projectId ?? null,
    prompt: record.prompt,
    editContext: record.editContext ?? null,
    error: record.error ?? null,
    createdAt: record.createdAt,
    startedAt: record.startedAt ?? null,
    completedAt: record.completedAt ?? null,
    eventCount: record.events.length,
  };
}

/**
 * Background CLI execution for a run. Uses project baseDir as cwd when present.
 */
async function executeCliRun(runId: string): Promise<void> {
  const reg = getGlobalRunRegistry();
  const run = reg.get(runId);
  if (!run || !run.agentId) return;
  if (run.status === 'canceled' || run.status === 'succeeded' || run.status === 'failed') {
    return;
  }

  const def = getDefById(run.agentId);
  if (!def) {
    reg.setStatus(runId, 'failed', 'Unknown agent');
    reg.appendEvent(runId, 'run.failed', { error: 'Unknown agent' });
    return;
  }

  let cwd: string | undefined;
  let filesBefore: Set<string> | undefined;
  if (run.projectId) {
    const project = getProject(run.projectId);
    if (project?.baseDir) {
      cwd = project.baseDir;
      try {
        filesBefore = new Set(
          listProjectFiles(project.baseDir).filter((f) => f.type === 'file').map((f) => f.path),
        );
      } catch {
        filesBefore = undefined;
      }
    }
  }

  const controller = run.abort ?? new AbortController();
  run.abort = controller;

  try {
    const result = await spawnRegistryAgent({
      agentId: run.agentId,
      prompt: run.prompt ?? '',
      cwd,
      signal: controller.signal,
      runId,
      projectId: run.projectId ?? undefined,
      serverUrl: getRuntimeServerUrl(),
      authToken: getRuntimeAuthToken(),
      onChunk: (chunk) => {
        // Re-check cancel
        const current = reg.get(runId);
        if (!current || current.status === 'canceled') return;
        reg.appendEvent(runId, 'run.stdout', { chunk: chunk.slice(0, 16_384) });
      },
    });

    const current = reg.get(runId);
    if (!current || current.status === 'canceled') return;

    // Detect new files under project (best-effort; content-hash compare is later)
    if (cwd && filesBefore) {
      try {
        const after = listProjectFiles(cwd)
          .filter((f) => f.type === 'file')
          .map((f) => f.path);
        const created = after.filter((p) => !filesBefore!.has(p));
        if (created.length > 0) {
          reg.appendEvent(runId, 'run.files_changed', {
            paths: created.slice(0, 200),
            kind: 'created',
          });
        }
      } catch {
        // ignore listing errors
      }
    }

    // Re-read status after spawn (cancel may have raced)
    const latest = reg.get(runId);
    if (!latest || latest.status === 'canceled' || controller.signal.aborted) {
      return;
    }

    if (result.exitCode === 0 || result.exitCode === null) {
      reg.appendEvent(runId, 'run.succeeded', {
        exitCode: result.exitCode,
        outputChars: result.output.length,
      });
      reg.setStatus(runId, 'succeeded');
    } else {
      const err = `CLI exited with code ${result.exitCode}`;
      reg.appendEvent(runId, 'run.failed', { error: err, exitCode: result.exitCode });
      reg.setStatus(runId, 'failed', err);
    }
  } catch (err) {
    const current = reg.get(runId);
    if (!current || current.status === 'canceled') return;
    const msg = publicErrorMessage(err, 'Agent run failed');
    reg.appendEvent(runId, 'run.failed', { error: msg });
    reg.setStatus(runId, 'failed', msg);
  }
}

runs.get('/', (c) => {
  const projectId = safeRouteId(c.req.query('projectId') ?? '') || undefined;
  const reg = getGlobalRunRegistry();
  const list = reg.list(projectId ? { projectId } : undefined).map(publicRun);
  return c.json({ ok: true, data: list });
});

runs.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const projectId =
    typeof body.projectId === 'string' ? safeRouteId(body.projectId) : '';
  if (projectId && !getProject(projectId)) {
    return c.json({ ok: false, error: 'Project not found' }, 404);
  }

  const agentId =
    typeof body.agentId === 'string' && !/[\0\r\n]/.test(body.agentId)
      ? body.agentId.trim()
      : null;
  if (agentId && !getDefById(agentId)) {
    return c.json({ ok: false, error: 'Unknown agentId' }, 400);
  }

  const promptRaw = typeof body.prompt === 'string' ? body.prompt : '';
  if (/\0/.test(promptRaw)) {
    return c.json({ ok: false, error: 'Invalid prompt' }, 400);
  }
  const MAX_PROMPT = 100_000;
  if (promptRaw.length > MAX_PROMPT) {
    return c.json({ ok: false, error: `prompt exceeds max length (${MAX_PROMPT})` }, 400);
  }
  if (!promptRaw.trim() && !body.editContext) {
    return c.json({ ok: false, error: 'prompt is required' }, 400);
  }

  const editContext = normalizeEditContext(body.editContext);
  if (body.editContext != null && !editContext) {
    return c.json({ ok: false, error: 'Invalid editContext' }, 400);
  }

  let { prompt: assembled } = assembleEditContextPrompt(promptRaw, editContext);

  // Inject design system + memory + preview comments for project chat (Tasks 5 / 7 / 1c)
  let commentCount = 0;
  let designSystemInjected = false;
  let memoryInjected = false;
  if (projectId) {
    const project = getProject(projectId);
    if (project?.designSystemId) {
      try {
        const [designMd, tokensCss, dsMeta] = await Promise.all([
          getDesignSystemContent(project.designSystemId),
          getDesignSystemTokens(project.designSystemId),
          getDesignSystem(project.designSystemId),
        ]);
        if (designMd) {
          assembled = assembleDesignContextPrompt(assembled, {
            name: dsMeta?.name,
            designMd,
            tokensCss,
          });
          designSystemInjected = true;
        }
      } catch {
        // non-fatal — continue without design context
      }
    }

    try {
      const mem = exportMemories();
      if (typeof mem === 'string' && mem.trim() && !/\0/.test(mem)) {
        let block = mem.trim();
        const MAX_MEM = 32_000;
        if (block.length > MAX_MEM) {
          block = block.slice(0, MAX_MEM) + '\n\n…[memory truncated]';
        }
        assembled = `${assembled.trim()}\n\n---\n## Agent Memory\n${block}`;
        memoryInjected = true;
      }
    } catch {
      // non-fatal
    }

    const filePath =
      editContext?.filePath
      ?? (typeof body.commentFilePath === 'string' ? body.commentFilePath : undefined);
    const comments = listPreviewComments(projectId, filePath).map((c) => ({
      filePath: c.filePath,
      selector: c.selector,
      body: c.body,
    }));
    // If file-scoped empty, fall back to all project comments
    const pool =
      comments.length > 0
        ? comments
        : listPreviewComments(projectId).map((c) => ({
            filePath: c.filePath,
            selector: c.selector,
            body: c.body,
          }));
    commentCount = pool.length;
    assembled = assemblePreviewCommentsPrompt(assembled, pool);
  }

  const reg = getGlobalRunRegistry();
  const run = reg.create({
    projectId: projectId || null,
    agentId,
    prompt: assembled,
    editContext: editContext ?? undefined,
  });

  reg.setStatus(run.id, 'running');
  reg.appendEvent(run.id, 'run.started', {
    agentId,
    projectId: projectId || null,
    hasEditContext: !!editContext,
    previewComments: commentCount,
    designSystem: designSystemInjected,
    memory: memoryInjected,
  });

  const dryRun = body.dryRun === true || body.execute === false;
  const shouldExecute = !dryRun && !!agentId;

  if (!shouldExecute) {
    reg.appendEvent(run.id, 'run.progress', {
      message: dryRun
        ? 'Dry-run: prompt assembled, CLI not spawned'
        : 'No agentId: run recorded without execution (set agentId to spawn CLI)',
      promptChars: assembled.length,
    });
    reg.setStatus(run.id, 'succeeded');
    reg.appendEvent(run.id, 'run.succeeded', { deferred: true, dryRun });
    return c.json({ ok: true, data: publicRun(reg.get(run.id)!) }, 201);
  }

  // Fire-and-forget live CLI spawn (events polled/streamed by client)
  void executeCliRun(run.id);

  return c.json({ ok: true, data: publicRun(reg.get(run.id)!) }, 201);
});

runs.get('/:id', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const run = getGlobalRunRegistry().get(id);
  if (!run) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: publicRun(run) });
});

runs.get('/:id/events', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const reg = getGlobalRunRegistry();
  if (!reg.get(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const after = safeRouteId(c.req.query('after') ?? '') || undefined;
  const events = reg.eventsAfter(id, after);
  return c.json({ ok: true, data: events });
});

/** Lightweight SSE: poll registry and push new events until terminal. */
runs.get('/:id/events/stream', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const reg = getGlobalRunRegistry();
  if (!reg.get(id)) return c.json({ ok: false, error: 'Not found' }, 404);

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return stream(c, async (s) => {
    let after: string | undefined;
    const started = Date.now();
    const maxMs = 10 * 60 * 1000;

    while (Date.now() - started < maxMs) {
      if (c.req.raw.signal.aborted) break;
      const run = reg.get(id);
      if (!run) break;

      const batch = reg.eventsAfter(id, after);
      for (const ev of batch) {
        after = ev.id;
        await s.write(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
      }

      if (
        run.status === 'succeeded'
        || run.status === 'failed'
        || run.status === 'canceled'
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  });
});

runs.post('/:id/cancel', (c) => {
  const id = paramId(c);
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const reg = getGlobalRunRegistry();
  if (!reg.get(id)) return c.json({ ok: false, error: 'Not found' }, 404);
  const ok = reg.cancel(id);
  if (!ok) {
    return c.json({ ok: false, error: 'Run already terminal' }, 409);
  }
  return c.json({ ok: true, data: publicRun(reg.get(id)!) });
});

export default runs;
export { runs, executeCliRun };
