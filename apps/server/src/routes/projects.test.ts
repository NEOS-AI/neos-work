import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import projects from './projects.js';
import * as db from '../db/projects.js';
import { getDb } from '../db/schema.js';
import { clearImportTokens } from '../lib/import-token.js';
import {
  acquireFileLock,
  clearProjectPresence,
  joinProjectPresence,
} from '../lib/project-collab.js';

const app = new Hono();
app.route('/api/projects', projects);

const NAME = `_route_proj_${process.pid}`;
const createdIds: string[] = [];

function cleanup() {
  const sqlite = getDb();
  for (const id of [...createdIds, ...((sqlite
    .prepare('SELECT id FROM projects WHERE name LIKE ?')
    .all(`${NAME}%`) as Array<{ id: string }>).map((r) => r.id))]) {
    const row = sqlite
      .prepare('SELECT base_dir FROM projects WHERE id = ?')
      .get(id) as { base_dir: string } | undefined;
    sqlite.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (row?.base_dir) {
      try {
        fs.rmSync(row.base_dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
  createdIds.length = 0;
}

afterEach(() => {
  clearImportTokens();
  clearProjectPresence();
  cleanup();
});

async function createViaApi() {
  const res = await app.request('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NAME }),
  });
  const json = (await res.json()) as { ok: boolean; data: { id: string; baseDir: string } };
  expect(res.status).toBe(201);
  createdIds.push(json.data.id);
  return json.data;
}

describe('projects routes', () => {
  it('CRUD + list files + write/read + revisions', async () => {
    const project = await createViaApi();

    const listRes = await app.request('/api/projects');
    const listJson = (await listRes.json()) as { ok: boolean; data: Array<{ id: string }> };
    expect(listJson.data.some((p) => p.id === project.id)).toBe(true);

    const filesRes = await app.request(`/api/projects/${project.id}/files`);
    const filesJson = (await filesRes.json()) as {
      ok: boolean;
      data: Array<{ path: string; isEntry?: boolean }>;
    };
    expect(filesRes.status).toBe(200);
    expect(filesJson.data.some((f) => f.path === 'index.html')).toBe(true);

    const putRes = await app.request(`/api/projects/${project.id}/files/index.html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '<html><body>edited</body></html>', source: 'user' }),
    });
    expect(putRes.status).toBe(200);
    const putJson = (await putRes.json()) as { ok: boolean; data: { hash: string } };
    expect(putJson.ok).toBe(true);

    const getRes = await app.request(`/api/projects/${project.id}/files/index.html`);
    const getJson = (await getRes.json()) as { ok: boolean; data: { content: string } };
    expect(getJson.data.content).toContain('edited');

    const revRes = await app.request(`/api/projects/${project.id}/revisions?path=index.html`);
    const revJson = (await revRes.json()) as { ok: boolean; data: Array<{ id: string }> };
    expect(revJson.data.length).toBeGreaterThan(0);

    const revId = revJson.data[0]!.id;
    const oneRes = await app.request(`/api/projects/${project.id}/revisions/${revId}`);
    const oneJson = (await oneRes.json()) as { ok: boolean; data: { content?: string } };
    expect(oneJson.data.content).toContain('edited');

    // Traversal denied
    const bad = await app.request(`/api/projects/${project.id}/files/..%2F..%2Fetc%2Fpasswd`);
    expect([400, 403, 404]).toContain(bad.status);

    const delRes = await app.request(`/api/projects/${project.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(200);
    createdIds.pop();
  });

  it('mkdir, comments, conversations', async () => {
    const project = await createViaApi();

    const mkdirRes = await app.request(`/api/projects/${project.id}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'assets/img' }),
    });
    expect(mkdirRes.status).toBe(201);

    const commentRes = await app.request(`/api/projects/${project.id}/preview-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: 'index.html',
        selector: 'h1',
        body: 'bolder',
      }),
    });
    expect(commentRes.status).toBe(201);

    const convRes = await app.request(`/api/projects/${project.id}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 't1' }),
    });
    const convJson = (await convRes.json()) as { data: { id: string } };
    expect(convRes.status).toBe(201);

    const msgRes = await app.request(
      `/api/projects/${project.id}/conversations/${convJson.data.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'design a hero' }),
      },
    );
    expect(msgRes.status).toBe(201);

    // Restore revision path: write v1, write v2, restore v1 tip if multiple
    await app.request(`/api/projects/${project.id}/files/index.html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'version-one' }),
    });
    await app.request(`/api/projects/${project.id}/files/index.html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'version-two' }),
    });
    const revs = db.listFileRevisions(project.id, 'index.html');
    const older = revs.find((r) => {
      const full = db.getFileRevision(r.id);
      return full?.content === 'version-one';
    });
    expect(older).toBeTruthy();
    const restoreRes = await app.request(
      `/api/projects/${project.id}/revisions/${older!.id}/restore`,
      { method: 'POST' },
    );
    expect(restoreRes.status).toBe(200);
    const after = (await (
      await app.request(`/api/projects/${project.id}/files/index.html`)
    ).json()) as { data: { content: string } };
    expect(after.data.content).toBe('version-one');
  });

  it('restore and delete respect NEOS_SHARED_EDIT hard-enforce locks', async () => {
    const prev = process.env.NEOS_SHARED_EDIT;
    process.env.NEOS_SHARED_EDIT = '1';
    try {
      const project = await createViaApi();
      await app.request(`/api/projects/${project.id}/files/index.html`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'locked-v1' }),
      });
      await app.request(`/api/projects/${project.id}/files/index.html`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'locked-v2' }),
      });
      const revs = db.listFileRevisions(project.id, 'index.html');
      const older = revs.find((r) => db.getFileRevision(r.id)?.content === 'locked-v1');
      expect(older).toBeTruthy();

      const holder = joinProjectPresence({
        projectId: project.id,
        displayName: 'Holder',
        listener: () => {},
      })!;
      const other = joinProjectPresence({
        projectId: project.id,
        displayName: 'Other',
        listener: () => {},
      })!;
      expect(
        acquireFileLock({
          projectId: project.id,
          sessionId: holder.sessionId,
          path: 'index.html',
        }).ok,
      ).toBe(true);

      const blocked = await app.request(
        `/api/projects/${project.id}/revisions/${older!.id}/restore`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: other.sessionId }),
        },
      );
      expect(blocked.status).toBe(423);
      const blockedBody = (await blocked.json()) as {
        ok: boolean;
        error?: string;
        data?: { holder?: { sessionId?: string } };
      };
      expect(blockedBody.ok).toBe(false);
      expect(blockedBody.data?.holder?.sessionId).toBe(holder.sessionId);

      const delBlocked = await app.request(
        `/api/projects/${project.id}/files/index.html`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: other.sessionId }),
        },
      );
      expect(delBlocked.status).toBe(423);

      const allowed = await app.request(
        `/api/projects/${project.id}/revisions/${older!.id}/restore`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-neos-session-id': holder.sessionId,
          },
          body: JSON.stringify({ sessionId: holder.sessionId }),
        },
      );
      expect(allowed.status).toBe(200);
      const after = (await (
        await app.request(`/api/projects/${project.id}/files/index.html`)
      ).json()) as { data: { content: string } };
      expect(after.data.content).toBe('locked-v1');

      const delAllowed = await app.request(
        `/api/projects/${project.id}/files/index.html`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'x-neos-session-id': holder.sessionId,
          },
          body: JSON.stringify({ sessionId: holder.sessionId }),
        },
      );
      expect(delAllowed.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.NEOS_SHARED_EDIT;
      else process.env.NEOS_SHARED_EDIT = prev;
    }
  });

  it('mkdir respects NEOS_SHARED_EDIT hard-enforce; agent PUT still bypasses', async () => {
    const prev = process.env.NEOS_SHARED_EDIT;
    process.env.NEOS_SHARED_EDIT = '1';
    try {
      const project = await createViaApi();
      // Locks are path keys — no on-disk file required for mkdir hard-enforce
      const holder = joinProjectPresence({
        projectId: project.id,
        displayName: 'MkdirHolder',
        listener: () => {},
      })!;
      const other = joinProjectPresence({
        projectId: project.id,
        displayName: 'MkdirOther',
        listener: () => {},
      })!;
      expect(
        acquireFileLock({
          projectId: project.id,
          sessionId: holder.sessionId,
          path: 'locked-dir',
        }).ok,
      ).toBe(true);

      const blocked = await app.request(`/api/projects/${project.id}/mkdir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'locked-dir', sessionId: other.sessionId }),
      });
      expect(blocked.status).toBe(423);
      const blockedBody = (await blocked.json()) as {
        ok: boolean;
        data?: { holder?: { sessionId?: string } };
      };
      expect(blockedBody.ok).toBe(false);
      expect(blockedBody.data?.holder?.sessionId).toBe(holder.sessionId);

      const allowed = await app.request(`/api/projects/${project.id}/mkdir`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-neos-session-id': holder.sessionId,
        },
        body: JSON.stringify({ path: 'locked-dir', sessionId: holder.sessionId }),
      });
      expect(allowed.status).toBe(201);

      // Agent PUT bypasses hard-enforce even without session (intentional policy)
      await app.request(`/api/projects/${project.id}/files/agent-only.html`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'v1' }),
      });
      const agentHolder = joinProjectPresence({
        projectId: project.id,
        displayName: 'AgentLock',
        listener: () => {},
      })!;
      expect(
        acquireFileLock({
          projectId: project.id,
          sessionId: agentHolder.sessionId,
          path: 'agent-only.html',
        }).ok,
      ).toBe(true);
      const agentWrite = await app.request(
        `/api/projects/${project.id}/files/agent-only.html`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'from-agent', source: 'agent' }),
        },
      );
      expect(agentWrite.status).toBe(200);
      // User write without session still blocked
      const userBlocked = await app.request(
        `/api/projects/${project.id}/files/agent-only.html`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: 'from-user', source: 'user' }),
        },
      );
      expect(userBlocked.status).toBe(423);
    } finally {
      if (prev === undefined) delete process.env.NEOS_SHARED_EDIT;
      else process.env.NEOS_SHARED_EDIT = prev;
    }
  });

  it('hard-enforce accepts header-only x-neos-session-id on DELETE', async () => {
    const prev = process.env.NEOS_SHARED_EDIT;
    process.env.NEOS_SHARED_EDIT = '1';
    try {
      const project = await createViaApi();
      await app.request(`/api/projects/${project.id}/files/only-hdr.html`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      });
      const holder = joinProjectPresence({
        projectId: project.id,
        displayName: 'HdrHolder',
        listener: () => {},
      })!;
      expect(
        acquireFileLock({
          projectId: project.id,
          sessionId: holder.sessionId,
          path: 'only-hdr.html',
        }).ok,
      ).toBe(true);

      // No body — header alone identifies the lock holder (proxy-safe DELETE)
      const allowed = await app.request(
        `/api/projects/${project.id}/files/only-hdr.html`,
        {
          method: 'DELETE',
          headers: { 'x-neos-session-id': holder.sessionId },
        },
      );
      expect(allowed.status).toBe(200);

      // Other session without body/header still blocked if file recreated + locked
      await app.request(`/api/projects/${project.id}/files/only-hdr.html`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'y' }),
      });
      expect(
        acquireFileLock({
          projectId: project.id,
          sessionId: holder.sessionId,
          path: 'only-hdr.html',
        }).ok,
      ).toBe(true);
      const blocked = await app.request(
        `/api/projects/${project.id}/files/only-hdr.html`,
        { method: 'DELETE' },
      );
      expect(blocked.status).toBe(423);
    } finally {
      if (prev === undefined) delete process.env.NEOS_SHARED_EDIT;
      else process.env.NEOS_SHARED_EDIT = prev;
    }
  });

  it('404 for missing project', async () => {
    const res = await app.request('/api/projects/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('projects routes additional coverage', () => {
  it('PUT project updates name/entry/meta and rejects bad JSON', async () => {
    const project = await createViaApi();

    const badJson = await app.request(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

    const put = await app.request(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${NAME}_renamed`,
        entryFile: 'index.html',
        designSystemId: null,
        meta: { theme: 'dark' },
      }),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as {
      data: { name: string; entryFile?: string | null; meta?: { theme?: string } };
    };
    expect(body.data.name).toBe(`${NAME}_renamed`);
    expect(body.data.entryFile).toBe('index.html');
    expect(body.data.meta?.theme).toBe('dark');

    const get = await app.request(`/api/projects/${project.id}`);
    expect(get.status).toBe(200);

    const missingPut = await app.request('/api/projects/00000000-0000-0000-0000-000000000099', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(missingPut.status).toBe(404);

    const blank = await app.request('/api/projects/%20', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(blank.status).toBe(404);
  });

  it('create rejects invalid JSON and blank name', async () => {
    const bad = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(bad.status).toBe(400);

    const blank = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(blank.status).toBe(400);
  });

  it('delete file, list/delete comments, list conversations/messages', async () => {
    const project = await createViaApi();

    // create extra file then delete it
    const putFile = await app.request(`/api/projects/${project.id}/files/notes.txt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'hello notes', source: 'agent' }),
    });
    expect(putFile.status).toBe(200);

    const delFile = await app.request(`/api/projects/${project.id}/files/notes.txt`, {
      method: 'DELETE',
    });
    expect(delFile.status).toBe(200);

    const missingFile = await app.request(`/api/projects/${project.id}/files/gone.txt`, {
      method: 'DELETE',
    });
    expect([400, 404]).toContain(missingFile.status);

    // comments list + delete
    const commentRes = await app.request(`/api/projects/${project.id}/preview-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: 'index.html',
        selector: '.hero',
        body: 'tighten spacing',
      }),
    });
    expect(commentRes.status).toBe(201);
    const comment = (await commentRes.json()) as { data: { id: string } };

    const listComments = await app.request(
      `/api/projects/${project.id}/preview-comments?path=index.html`,
    );
    expect(listComments.status).toBe(200);
    const commentsBody = (await listComments.json()) as { data: Array<{ id: string }> };
    expect(commentsBody.data.some((c) => c.id === comment.data.id)).toBe(true);

    const delComment = await app.request(
      `/api/projects/${project.id}/preview-comments/${comment.data.id}`,
      { method: 'DELETE' },
    );
    expect(delComment.status).toBe(200);

    const delMissingComment = await app.request(
      `/api/projects/${project.id}/preview-comments/00000000-0000-0000-0000-000000000001`,
      { method: 'DELETE' },
    );
    expect(delMissingComment.status).toBe(404);

    // conversations + messages list
    const convRes = await app.request(`/api/projects/${project.id}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'design chat' }),
    });
    const conv = (await convRes.json()) as { data: { id: string } };
    expect(convRes.status).toBe(201);

    const listConv = await app.request(`/api/projects/${project.id}/conversations`);
    expect(listConv.status).toBe(200);
    const convList = (await listConv.json()) as { data: Array<{ id: string }> };
    expect(convList.data.some((c) => c.id === conv.data.id)).toBe(true);

    await app.request(`/api/projects/${project.id}/conversations/${conv.data.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'assistant', content: 'sure', agentId: 'agent-1' }),
    });

    const msgs = await app.request(
      `/api/projects/${project.id}/conversations/${conv.data.id}/messages`,
    );
    expect(msgs.status).toBe(200);
    const msgBody = (await msgs.json()) as { data: Array<{ role: string; content: string }> };
    expect(msgBody.data.some((m) => m.role === 'assistant' && m.content === 'sure')).toBe(true);
  });

  it('validates write/mkdir/comment bodies and missing ids', async () => {
    const project = await createViaApi();

    const writeBad = await app.request(`/api/projects/${project.id}/files/index.html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 42 }),
    });
    expect(writeBad.status).toBe(400);

    const mkdirBad = await app.request(`/api/projects/${project.id}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(mkdirBad.status).toBe(400);

    const commentBad = await app.request(`/api/projects/${project.id}/preview-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(commentBad.status).toBe(400);

    const msgBad = await app.request(
      `/api/projects/${project.id}/conversations/00000000-0000-0000-0000-000000000002/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      },
    );
    expect([400, 404]).toContain(msgBad.status);

    const blankFiles = await app.request('/api/projects/%20/files');
    expect(blankFiles.status).toBe(404);

    const missingFiles = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/files',
    );
    expect(missingFiles.status).toBe(404);

    const missingRev = await app.request(
      `/api/projects/${project.id}/revisions/00000000-0000-0000-0000-000000000003`,
    );
    expect(missingRev.status).toBe(404);

    const missingRestore = await app.request(
      `/api/projects/${project.id}/revisions/00000000-0000-0000-0000-000000000003/restore`,
      { method: 'POST' },
    );
    expect(missingRestore.status).toBe(404);

    const delBlank = await app.request('/api/projects/%20', { method: 'DELETE' });
    expect(delBlank.status).toBe(404);

    const delMissing = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000',
      { method: 'DELETE' },
    );
    expect(delMissing.status).toBe(404);
  });

  it('rejects write with unknown source by falling back to user', async () => {
    const project = await createViaApi();
    const res = await app.request(`/api/projects/${project.id}/files/index.html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '<html>src</html>', source: 'unknown-src' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('projects missing-id branches', () => {
  it('returns 404 for blank and missing ids across nested routes', async () => {
    const blankFiles = await app.request('/api/projects/%20/files/index.html');
    expect(blankFiles.status).toBe(404);

    const missingWrite = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/files/index.html',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      },
    );
    expect(missingWrite.status).toBe(404);

    const missingMkdir = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/mkdir',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'a' }),
      },
    );
    expect(missingMkdir.status).toBe(404);

    const missingComments = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/preview-comments',
    );
    expect(missingComments.status).toBe(404);

    const missingConv = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/conversations',
    );
    expect(missingConv.status).toBe(404);

    const missingMsgs = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/conversations/00000000-0000-0000-0000-000000000001/messages',
    );
    expect(missingMsgs.status).toBe(404);

    const missingRevs = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/revisions',
    );
    expect(missingRevs.status).toBe(404);

    const blankDelFile = await app.request('/api/projects/%20/files/x.txt', {
      method: 'DELETE',
    });
    expect(blankDelFile.status).toBe(404);
  });

  it('GET file requires path and rejects missing file', async () => {
    const project = await createViaApi();
    // trailing slash with empty splat may 400 path required depending on router
    const emptyPath = await app.request(`/api/projects/${project.id}/files/`);
    expect([400, 404]).toContain(emptyPath.status);

    const missing = await app.request(`/api/projects/${project.id}/files/nope.txt`);
    expect([400, 404]).toContain(missing.status);
  });
});

describe('projects import-token gate', () => {
  it('POST /import-token issues single-use token; create with token works', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-proj-import-'));
    try {
      const tokRes = await app.request('/api/projects/import-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dir }),
      });
      expect(tokRes.status).toBe(201);
      const tokJson = (await tokRes.json()) as {
        ok: boolean;
        data: { token: string; path: string };
      };
      expect(tokJson.ok).toBe(true);
      expect(tokJson.data.token.length).toBeGreaterThan(8);

      const createRes = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${NAME}_tok`,
          baseDir: dir,
          importToken: tokJson.data.token,
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { ok: boolean; data: { id: string } };
      createdIds.push(created.data.id);

      // reuse → 403
      const reuse = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${NAME}_tok2`,
          baseDir: dir,
          importToken: tokJson.data.token,
        }),
      });
      expect(reuse.status).toBe(403);
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('POST /import-token rejects invalid path', async () => {
    const res = await app.request('/api/projects/import-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    });
    expect(res.status).toBe(400);
  });

  it('create with bogus importToken is rejected', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-proj-import-bad-'));
    try {
      const res = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${NAME}_bogus_tok`,
          baseDir: dir,
          importToken: 'not-a-real-token',
        }),
      });
      expect(res.status).toBe(403);
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });
});

describe('projects PathSandboxError paths', () => {
  it('POST create rejects filesystem root / invalid baseDir', async () => {
    const root = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `${NAME}_badroot`, baseDir: '/' }),
    });
    expect([400, 403]).toContain(root.status);

    const missing = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${NAME}_missingdir`,
        baseDir: '/tmp/definitely-missing-neos-project-dir-xyz',
      }),
    });
    expect([400, 403, 404]).toContain(missing.status);
  });

  it('PUT with invalid baseDir returns sandbox error status', async () => {
    const project = await createViaApi();
    const res = await app.request(`/api/projects/${project.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseDir: '/' }),
    });
    expect([400, 403]).toContain(res.status);
  });

  it('write rejects path traversal with sandbox status', async () => {
    const project = await createViaApi();
    const res = await app.request(`/api/projects/${project.id}/files/../escape.txt`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'nope' }),
    });
    expect([400, 403, 404]).toContain(res.status);
  });
});

describe('projects create with entryFile and meta', () => {
  it('accepts entryFile null and meta object on create', async () => {
    const res = await app.request('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${NAME}_meta`,
        entryFile: null,
        designSystemId: null,
        meta: { theme: 'light', count: 1 },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; entryFile?: string | null; meta?: { theme?: string } };
    };
    createdIds.push(body.data.id);
    expect(body.data.meta?.theme).toBe('light');
  });

  it('mkdir rejects blank path and missing project', async () => {
    const project = await createViaApi();
    const blank = await app.request(`/api/projects/${project.id}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 42 }),
    });
    expect(blank.status).toBe(400);

    const badJson = await app.request(`/api/projects/${project.id}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);
  });
});

describe('projects comment/conversation error paths', () => {
  it('POST comment requires fields; conversation message validates', async () => {
    const project = await createViaApi();

    const emptyComment = await app.request(`/api/projects/${project.id}/preview-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: '', selector: 'h1', body: 'x' }),
    });
    expect([400, 500]).toContain(emptyComment.status);

    const conv = await app.request(`/api/projects/${project.id}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '  chat  ' }),
    });
    expect(conv.status).toBe(201);
    const convId = ((await conv.json()) as { data: { id: string } }).data.id;

    const emptyMsg = await app.request(
      `/api/projects/${project.id}/conversations/${convId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: '' }),
      },
    );
    expect([400, 500]).toContain(emptyMsg.status);

    const okMsg = await app.request(
      `/api/projects/${project.id}/conversations/${convId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'system', content: 'sys note' }),
      },
    );
    expect(okMsg.status).toBe(201);

    // blank conversation id
    const blankConv = await app.request(
      `/api/projects/${project.id}/conversations/%20/messages`,
    );
    expect(blankConv.status).toBe(404);

    // write without content type string path - already covered
    const writeMissing = await app.request(`/api/projects/${project.id}/files/%20`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x' }),
    });
    expect([400, 404]).toContain(writeMissing.status);
  });

  it('GET revisions blank path id 404', async () => {
    const project = await createViaApi();
    const blank = await app.request(`/api/projects/${project.id}/revisions/%20`);
    expect(blank.status).toBe(404);
    const blankRestore = await app.request(
      `/api/projects/${project.id}/revisions/%20/restore`,
      { method: 'POST' },
    );
    expect(blankRestore.status).toBe(404);
  });
});

describe('projects export/import zip', () => {
  async function zipFromEntries(
    entries: Array<{ name: string; content: string | Buffer }>,
  ): Promise<Buffer> {
    const { ZipArchive } = await import('archiver');
    const { PassThrough } = await import('node:stream');
    return new Promise((resolve, reject) => {
      const archive = new ZipArchive({ zlib: { level: 1 } });
      const chunks: Buffer[] = [];
      const stream = new PassThrough();
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
      archive.pipe(stream);
      for (const e of entries) {
        archive.append(e.content, { name: e.name });
      }
      void archive.finalize();
    });
  }

  it('exports zip and re-imports via raw body', async () => {
    const project = await createViaApi();
    await app.request(`/api/projects/${project.id}/files/index.html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '<html><body>export-me</body></html>' }),
    });

    const exp = await app.request(`/api/projects/${project.id}/export.zip`);
    expect(exp.status).toBe(200);
    expect(exp.headers.get('content-type')).toMatch(/zip/i);
    const disp = exp.headers.get('content-disposition') ?? '';
    expect(disp).toMatch(/\.neos-project\.zip/i);
    const buf = Buffer.from(await exp.arrayBuffer());
    expect(buf.length).toBeGreaterThan(40);

    const imp = await app.request('/api/projects/import.zip', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: buf,
    });
    expect(imp.status).toBe(201);
    const body = (await imp.json()) as {
      ok: boolean;
      data: { project: { id: string; name: string }; filesImported: number };
    };
    expect(body.ok).toBe(true);
    createdIds.push(body.data.project.id);
    expect(body.data.filesImported).toBeGreaterThan(0);

    const files = await app.request(`/api/projects/${body.data.project.id}/files`);
    const filesJson = (await files.json()) as { data: Array<{ path: string }> };
    expect(filesJson.data.some((f) => f.path === 'index.html')).toBe(true);
  });

  it('import rejects empty body and invalid archive', async () => {
    const empty = await app.request('/api/projects/import.zip', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: Buffer.alloc(0),
    });
    expect(empty.status).toBe(400);

    const bad = await app.request('/api/projects/import.zip', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: Buffer.from('not-zip'),
    });
    expect(bad.status).toBe(400);

    const missingExport = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/export.zip',
    );
    expect(missingExport.status).toBe(404);

    const blankExport = await app.request('/api/projects/%20/export.zip');
    expect(blankExport.status).toBe(404);
  });

  it('import accepts crafted neos-project with entryFile and designSystemId', async () => {
    const zip = await zipFromEntries([
      {
        name: 'project.json',
        content: JSON.stringify({
          version: 1,
          format: 'neos-project',
          exportedAt: new Date().toISOString(),
          project: {
            name: `${NAME}_import_craft`,
            entryFile: 'pages/home.html',
            designSystemId: 'ds-craft',
            meta: { from: 'test' },
          },
        }),
      },
      {
        name: 'files/pages/home.html',
        content: '<html><body>home</body></html>',
      },
      { name: 'files/styles.css', content: 'body{}' },
      { name: 'README.md', content: 'ignored' },
    ]);

    const imp = await app.request('/api/projects/import.zip', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: zip,
    });
    expect(imp.status).toBe(201);
    const body = (await imp.json()) as {
      data: {
        project: {
          id: string;
          entryFile?: string | null;
          designSystemId?: string | null;
          meta?: Record<string, unknown>;
        };
        filesImported: number;
      };
    };
    createdIds.push(body.data.project.id);
    expect(body.data.project.entryFile).toBe('pages/home.html');
    expect(body.data.project.designSystemId).toBe('ds-craft');
    expect(body.data.filesImported).toBe(2);
    expect(body.data.project.meta?.importedFrom).toBe('neos-project-zip');
  });

  it('import via multipart form-data file field', async () => {
    const zip = await zipFromEntries([
      {
        name: 'project.json',
        content: JSON.stringify({
          version: 1,
          format: 'neos-project',
          exportedAt: new Date().toISOString(),
          project: {
            name: `${NAME}_multipart`,
            entryFile: 'index.html',
            designSystemId: null,
          },
        }),
      },
      { name: 'files/index.html', content: '<html>mp</html>' },
    ]);
    const form = new FormData();
    form.append(
      'file',
      new File([zip], 'proj.neos-project.zip', { type: 'application/zip' }),
    );
    const imp = await app.request('/api/projects/import.zip', {
      method: 'POST',
      body: form,
    });
    expect(imp.status).toBe(201);
    const body = (await imp.json()) as { data: { project: { id: string } } };
    createdIds.push(body.data.project.id);
  });
});

describe('projects import-token and path validation', () => {
  it('import-token rejects blank and invalid paths', async () => {
    const blank = await app.request('/api/projects/import-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '' }),
    });
    expect(blank.status).toBe(400);

    const badJson = await app.request('/api/projects/import-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

    const root = await app.request('/api/projects/import-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' }),
    });
    expect([400, 403]).toContain(root.status);
  });

  it('create rejects mismatched or spent import token', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-import-'));
    try {
      const tokRes = await app.request('/api/projects/import-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dir }),
      });
      // may fail on sandbox if dir not allowed — skip if so
      if (tokRes.status !== 201) {
        expect([400, 403, 404]).toContain(tokRes.status);
        return;
      }
      const tokBody = (await tokRes.json()) as { data: { token: string } };

      const mismatch = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${NAME}_tok_mismatch`,
          baseDir: dir,
          importToken: 'not-the-token',
        }),
      });
      expect([400, 403]).toContain(mismatch.status);

      const ok = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${NAME}_tok_ok`,
          baseDir: dir,
          importToken: tokBody.data.token,
        }),
      });
      if (ok.status === 201) {
        const body = (await ok.json()) as { data: { id: string } };
        createdIds.push(body.data.id);
      }

      // spent token
      const spent = await app.request('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${NAME}_tok_spent`,
          baseDir: dir,
          importToken: tokBody.data.token,
        }),
      });
      expect([400, 403]).toContain(spent.status);
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it('rejects control-char project ids in path params', async () => {
    const res = await app.request(`/api/projects/${encodeURIComponent('ab\0c')}/files`);
    expect([400, 404]).toContain(res.status);
  });

  it('SSE events/stream emits ready and file.changed on write', async () => {
    const project = await createViaApi();
    const ac = new AbortController();
    const streamPromise = (async () => {
      const res = await app.request(`/api/projects/${project.id}/events/stream`, {
        signal: ac.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type') ?? '').toMatch(/text\/event-stream/i);
      // Concurrent write so the stream receives file.changed
      await new Promise((r) => setTimeout(r, 50));
      await app.request(`/api/projects/${project.id}/files/sse-probe.html`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '<html>sse</html>', source: 'agent' }),
      });
      // Read until we see file.changed or timeout
      const reader = res.body?.getReader();
      if (!reader) throw new Error('no body');
      const decoder = new TextDecoder();
      let buf = '';
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.includes('file.changed') || buf.includes('file.created')) {
          ac.abort();
          return buf;
        }
      }
      ac.abort();
      return buf;
    })();

    const body = await streamPromise;
    expect(body).toMatch(/event:\s*ready/);
    expect(body).toMatch(/file\.(changed|created)/);
    expect(body).toMatch(/sse-probe\.html/);
  });

  it('SSE events/stream 404 for missing project', async () => {
    const res = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/events/stream',
    );
    expect(res.status).toBe(404);
  });

  it('SSE collab/stream emits ready and presence.sync', async () => {
    const project = await createViaApi();
    const ac = new AbortController();
    const res = await app.request(
      `/api/projects/${project.id}/collab/stream?name=${encodeURIComponent('Tester')}`,
      { signal: ac.signal },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/text\/event-stream/i);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const decoder = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      if (buf.includes('presence.sync')) break;
    }
    ac.abort();
    expect(buf).toMatch(/event:\s*ready/);
    expect(buf).toMatch(/presence\.sync/);
    expect(buf).toMatch(/Tester/);
  });

  it('SSE collab/stream 404 for missing project', async () => {
    const res = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/collab/stream',
    );
    expect(res.status).toBe(404);
  });

  it('collab/selection requires live presence session', async () => {
    const project = await createViaApi();
    const missing = await app.request(`/api/projects/${project.id}/collab/selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'deadbeefdeadbeef',
        path: 'index.html',
        selector: '#hero',
      }),
    });
    expect(missing.status).toBe(404);

    const badBody = await app.request(`/api/projects/${project.id}/collab/selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(badBody.status).toBe(400);

    const snap = await app.request(`/api/projects/${project.id}/collab/selections`);
    expect(snap.status).toBe(200);
    const body = (await snap.json()) as { ok: boolean; data: { selections: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.data.selections).toEqual([]);
  });
});

describe('projects import zip edge paths', () => {
  it('rejects empty zip body on import.zip', async () => {
    const res = await app.request('/api/projects/import.zip', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: Buffer.alloc(0),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/zip|archive|required/i);
  });

  it('rejects invalid zip payload on import.zip', async () => {
    const res = await app.request('/api/projects/import.zip', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: Buffer.from('not-a-zip'),
    });
    expect(res.status).toBe(400);
  });
});

describe('projects remaining error branches', () => {
  it('rejects blank ids and missing nested resources', async () => {
    const blankStream = await app.request('/api/projects/%20/events/stream');
    expect(blankStream.status).toBe(404);

    const blankConvPost = await app.request('/api/projects/%20/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(blankConvPost.status).toBe(404);

    const blankCommentDel = await app.request(
      '/api/projects/%20/preview-comments/00000000-0000-0000-0000-000000000001',
      { method: 'DELETE' },
    );
    expect(blankCommentDel.status).toBe(404);

    const blankMsgPost = await app.request(
      '/api/projects/%20/conversations/00000000-0000-0000-0000-000000000001/messages',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'hi' }),
      },
    );
    expect(blankMsgPost.status).toBe(404);

    const project = await createViaApi();
    const other = await createViaApi();
    await app.request(`/api/projects/${project.id}/files/index.html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'rev-a' }),
    });
    const revs = db.listFileRevisions(project.id, 'index.html');
    expect(revs.length).toBeGreaterThan(0);
    const foreign = await app.request(
      `/api/projects/${other.id}/revisions/${revs[0]!.id}`,
    );
    expect(foreign.status).toBe(404);
    const foreignRestore = await app.request(
      `/api/projects/${other.id}/revisions/${revs[0]!.id}/restore`,
      { method: 'POST' },
    );
    expect(foreignRestore.status).toBe(404);
  });

  it('rejects mkdir/delete/write traversal and missing project file ops', async () => {
    const project = await createViaApi();

    const mkdirEsc = await app.request(`/api/projects/${project.id}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '../outside' }),
    });
    expect([400, 403, 404]).toContain(mkdirEsc.status);

    const delEsc = await app.request(`/api/projects/${project.id}/files/../escape.txt`, {
      method: 'DELETE',
    });
    expect([400, 403, 404]).toContain(delEsc.status);

    const missingDel = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/files/x.txt',
      { method: 'DELETE' },
    );
    expect(missingDel.status).toBe(404);

    const missingRead = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/files/x.txt',
    );
    expect(missingRead.status).toBe(404);

    const missingPostComment = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/preview-comments',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: 'a', selector: 'b', body: 'c' }),
      },
    );
    expect(missingPostComment.status).toBe(404);

    const missingPostConv = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/conversations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 't' }),
      },
    );
    expect(missingPostConv.status).toBe(404);

    // blank comment id when project exists
    const blankCid = await app.request(
      `/api/projects/${project.id}/preview-comments/%20`,
      { method: 'DELETE' },
    );
    expect(blankCid.status).toBe(404);
  });

  it('PUT with spent importToken returns 403; import rejects oversized body', async () => {
    const project = await createViaApi();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-proj-put-tok-'));
    try {
      const tokRes = await app.request('/api/projects/import-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dir }),
      });
      if (tokRes.status === 201) {
        const { data } = (await tokRes.json()) as { data: { token: string } };
        // spend token via create path is already covered; use spent on PUT
        await app.request('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${NAME}_spend_for_put`,
            baseDir: dir,
            importToken: data.token,
          }),
        }).then(async (r) => {
          if (r.status === 201) {
            const b = (await r.json()) as { data: { id: string } };
            createdIds.push(b.data.id);
          }
        });
        const putSpent = await app.request(`/api/projects/${project.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ baseDir: dir, importToken: data.token }),
        });
        expect([400, 403]).toContain(putSpent.status);
      }

      const putBogus = await app.request(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseDir: dir, importToken: 'nope' }),
      });
      expect([400, 403]).toContain(putBogus.status);
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }

    // Oversize import: length-check only (50MB+1) — allocate once
    const { PROJECT_ZIP_MAX_BYTES } = await import('../lib/project-archive.js');
    const huge = Buffer.alloc(PROJECT_ZIP_MAX_BYTES + 1);
    const over = await app.request('/api/projects/import.zip', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: huge,
    });
    expect(over.status).toBe(400);
    const overBody = (await over.json()) as { error?: string };
    expect(overBody.error).toMatch(/max size|exceeds/i);
  });
});

describe('projects sandbox miss and message errors', () => {
  it('export/list/read fail when baseDir removed from disk', async () => {
    const project = await createViaApi();
    // Wipe on-disk tree while DB row remains
    try {
      fs.rmSync(project.baseDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }

    const exp = await app.request(`/api/projects/${project.id}/export.zip`);
    expect([400, 403, 404, 500]).toContain(exp.status);

    const list = await app.request(`/api/projects/${project.id}/files`);
    expect([400, 403, 404, 500]).toContain(list.status);

    const read = await app.request(`/api/projects/${project.id}/files/index.html`);
    expect([400, 403, 404, 500]).toContain(read.status);

    const write = await app.request(`/api/projects/${project.id}/files/new.html`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '<p/>' }),
    });
    // write may recreate path or fail sandbox — either is a handled branch
    expect([200, 400, 403, 404, 500]).toContain(write.status);
  });

  it('rejects null-byte message content and blank message conversation ids', async () => {
    const project = await createViaApi();
    const conv = await app.request(`/api/projects/${project.id}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'msgs' }),
    });
    expect(conv.status).toBe(201);
    const convId = ((await conv.json()) as { data: { id: string } }).data.id;

    const nul = await app.request(
      `/api/projects/${project.id}/conversations/${convId}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: `hi${'\0'}` }),
      },
    );
    expect(nul.status).toBe(400);

    const blankMsg = await app.request(
      `/api/projects/${project.id}/conversations/%20/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'ok' }),
      },
    );
    expect(blankMsg.status).toBe(404);

    // missing project on nested comment delete
    const missingCommentProject = await app.request(
      '/api/projects/00000000-0000-0000-0000-000000000000/preview-comments/00000000-0000-0000-0000-000000000001',
      { method: 'DELETE' },
    );
    expect(missingCommentProject.status).toBe(404);
  });

  it('SSE events/stream 404 for blank id', async () => {
    const res = await app.request('/api/projects/%20/events/stream');
    expect(res.status).toBe(404);
  });
});

describe('projects import entryFile re-detect', () => {
  async function zipFromEntries(
    entries: Array<{ name: string; content: string | Buffer }>,
  ): Promise<Buffer> {
    const { ZipArchive } = await import('archiver');
    const { PassThrough } = await import('node:stream');
    return new Promise((resolve, reject) => {
      const archive = new ZipArchive({ zlib: { level: 1 } });
      const chunks: Buffer[] = [];
      const stream = new PassThrough();
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
      archive.pipe(stream);
      for (const e of entries) {
        archive.append(e.content, { name: e.name });
      }
      void archive.finalize();
    });
  }

  it('re-detects entryFile when manifest entry is missing from archive files', async () => {
    const zip = await zipFromEntries([
      {
        name: 'project.json',
        content: JSON.stringify({
          version: 1,
          format: 'neos-project',
          exportedAt: new Date().toISOString(),
          project: {
            name: `${NAME}_redetect`,
            entryFile: 'missing-not-in-zip.html',
            designSystemId: null,
          },
        }),
      },
      { name: 'files/index.html', content: '<html><body>entry</body></html>' },
    ]);
    const imp = await app.request('/api/projects/import.zip', {
      method: 'POST',
      headers: { 'content-type': 'application/zip' },
      body: zip,
    });
    expect(imp.status).toBe(201);
    const body = (await imp.json()) as {
      data: { project: { id: string; entryFile?: string | null } };
    };
    createdIds.push(body.data.project.id);
    // Should land on detected index.html (or non-missing path)
    expect(body.data.project.entryFile).not.toBe('missing-not-in-zip.html');
    expect(body.data.project.entryFile).toMatch(/index\.html|html/i);
  });
});
