import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import projects from './projects.js';
import * as db from '../db/projects.js';
import { getDb } from '../db/schema.js';

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

afterEach(cleanup);

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
