import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import {
  getGlobalRunRegistry,
  resetGlobalRunRegistry,
} from '@neos-work/agent-runtime';
import * as projectsDb from '../db/projects.js';
import { getDb } from '../db/schema.js';
import {
  acquireFileLock,
  clearProjectPresence,
  joinProjectPresence,
} from '../lib/project-collab.js';
import { clearToolTokens, issueToolToken } from '../lib/tool-tokens.js';
import toolsFiles from './tools-files.js';

const app = new Hono();
app.route('/api/tools/files', toolsFiles);

const NAME = `_tool_files_${process.pid}`;
const ids: string[] = [];

function cleanup() {
  resetGlobalRunRegistry();
  clearToolTokens();
  clearProjectPresence();
  const db = getDb();
  for (const id of ids.splice(0)) {
    const row = db
      .prepare('SELECT base_dir FROM projects WHERE id = ?')
      .get(id) as { base_dir: string } | undefined;
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (row?.base_dir) {
      try {
        fs.rmSync(row.base_dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

afterEach(cleanup);

describe('tools files write (v0.11 M2)', () => {
  it('requires files capability and writes as agent', async () => {
    const p = projectsDb.createProject({ name: NAME });
    ids.push(p.id);

    const liveOnly = issueToolToken({
      projectId: p.id,
      capabilities: ['live-artifacts'],
    });
    const denied = await app.request('/api/tools/files/write', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${liveOnly.token}`,
      },
      body: JSON.stringify({ path: 'a.html', content: '<p>x</p>' }),
    });
    expect(denied.status).toBe(403);

    const tok = issueToolToken({
      projectId: p.id,
      capabilities: ['files'],
    });
    const ok = await app.request('/api/tools/files/write', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tok.token}`,
      },
      body: JSON.stringify({ path: 'a.html', content: '<p>hi</p>' }),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as {
      ok: boolean;
      data?: { path?: string; hash?: string; bytes?: number };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.path).toBe('a.html');
    expect(typeof body.data?.hash).toBe('string');
  });

  it('hard-enforces agent tool writes when both shared-edit flags on', async () => {
    const prev = process.env.NEOS_SHARED_EDIT;
    const prevAgents = process.env.NEOS_SHARED_EDIT_AGENTS;
    process.env.NEOS_SHARED_EDIT = '1';
    process.env.NEOS_SHARED_EDIT_AGENTS = '1';
    try {
      const p = projectsDb.createProject({ name: `${NAME}_lock` });
      ids.push(p.id);

      // seed file via tool write while unlocked
      const seedTok = issueToolToken({ projectId: p.id, capabilities: ['files'] });
      await app.request('/api/tools/files/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${seedTok.token}`,
        },
        body: JSON.stringify({ path: 'locked.html', content: 'v1' }),
      });

      const holder = joinProjectPresence({
        projectId: p.id,
        displayName: 'ToolHolder',
        listener: () => {},
      })!;
      expect(
        (
          await acquireFileLock({
            projectId: p.id,
            sessionId: holder.sessionId,
            path: 'locked.html',
          })
        ).ok,
      ).toBe(true);

      const tok = issueToolToken({ projectId: p.id, capabilities: ['files'] });

      // no session / run → 423
      const blocked = await app.request('/api/tools/files/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok.token}`,
        },
        body: JSON.stringify({ path: 'locked.html', content: 'blocked' }),
      });
      expect(blocked.status).toBe(423);
      const blockedBody = (await blocked.json()) as {
        ok: boolean;
        data?: { holder?: { sessionId?: string } };
      };
      expect(blockedBody.ok).toBe(false);
      expect(blockedBody.data?.holder?.sessionId).toBe(holder.sessionId);

      // as holder session → 200
      const asHolder = await app.request('/api/tools/files/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok.token}`,
          'x-neos-session-id': holder.sessionId,
        },
        body: JSON.stringify({
          path: 'locked.html',
          content: 'from-holder',
          sessionId: holder.sessionId,
        }),
      });
      expect(asHolder.status).toBe(200);

      // inherit via token-bound run collabSessionId
      const run = getGlobalRunRegistry().create({
        projectId: p.id,
        prompt: 'edit',
        collabSessionId: holder.sessionId,
      });
      const boundTok = issueToolToken({
        projectId: p.id,
        runId: run.id,
        capabilities: ['files'],
      });
      // re-lock after previous write may still hold
      await acquireFileLock({
        projectId: p.id,
        sessionId: holder.sessionId,
        path: 'locked.html',
      });
      const viaRun = await app.request('/api/tools/files/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${boundTok.token}`,
        },
        body: JSON.stringify({ path: 'locked.html', content: 'via-run-bind' }),
      });
      expect(viaRun.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.NEOS_SHARED_EDIT;
      else process.env.NEOS_SHARED_EDIT = prev;
      if (prevAgents === undefined) delete process.env.NEOS_SHARED_EDIT_AGENTS;
      else process.env.NEOS_SHARED_EDIT_AGENTS = prevAgents;
    }
  });

  it('does not 423 tool writes when agents hard-enforce is off', async () => {
    const prev = process.env.NEOS_SHARED_EDIT;
    const prevAgents = process.env.NEOS_SHARED_EDIT_AGENTS;
    process.env.NEOS_SHARED_EDIT = '1';
    delete process.env.NEOS_SHARED_EDIT_AGENTS;
    try {
      const p = projectsDb.createProject({ name: `${NAME}_bypass` });
      ids.push(p.id);
      const seedTok = issueToolToken({ projectId: p.id, capabilities: ['files'] });
      await app.request('/api/tools/files/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${seedTok.token}`,
        },
        body: JSON.stringify({ path: 'b.html', content: 'v1' }),
      });
      const holder = joinProjectPresence({
        projectId: p.id,
        displayName: 'H',
        listener: () => {},
      })!;
      expect(
        (
          await acquireFileLock({
            projectId: p.id,
            sessionId: holder.sessionId,
            path: 'b.html',
          })
        ).ok,
      ).toBe(true);

      const tok = issueToolToken({ projectId: p.id, capabilities: ['files'] });
      const res = await app.request('/api/tools/files/write', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok.token}`,
        },
        body: JSON.stringify({ path: 'b.html', content: 'agent-bypass' }),
      });
      expect(res.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.NEOS_SHARED_EDIT;
      else process.env.NEOS_SHARED_EDIT = prev;
      if (prevAgents === undefined) delete process.env.NEOS_SHARED_EDIT_AGENTS;
      else process.env.NEOS_SHARED_EDIT_AGENTS = prevAgents;
    }
  });

  it('rejects projectId override on tool write', async () => {
    const p = projectsDb.createProject({ name: `${NAME}_ov` });
    ids.push(p.id);
    const tok = issueToolToken({ projectId: p.id, capabilities: ['files'] });
    const res = await app.request('/api/tools/files/write', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tok.token}`,
      },
      body: JSON.stringify({
        path: 'x.html',
        content: 'x',
        projectId: 'other-project',
      }),
    });
    expect(res.status).toBe(403);
  });
});
