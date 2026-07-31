import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FILE_REVISION_CONTENT_MAX,
  FILE_REVISION_MAX_PER_PATH,
  PREVIEW_COMMENT_BODY_MAX,
  addMessage,
  createConversation,
  createPreviewComment,
  createProject,
  deletePreviewComment,
  deleteProject,
  getFileRevision,
  getProject,
  listFileRevisions,
  listMessages,
  listPreviewComments,
  listProjects,
  listConversations,
  recordFileRevision,
  updateProject,
} from './projects.js';
import { getDb } from './schema.js';

const NAME = `_cov_proj_${process.pid}`;
const createdIds: string[] = [];

function cleanup() {
  const db = getDb();
  for (const id of createdIds.splice(0)) {
    const row = db
      .prepare('SELECT base_dir FROM projects WHERE id = ?')
      .get(id) as { base_dir: string } | undefined;
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (row?.base_dir && row.base_dir.includes('neos-work')) {
      try {
        fs.rmSync(row.base_dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
  // Also by name
  const rows = db.prepare('SELECT id, base_dir FROM projects WHERE name LIKE ?').all(`${NAME}%`) as Array<{
    id: string;
    base_dir: string;
  }>;
  for (const r of rows) {
    db.prepare('DELETE FROM projects WHERE id = ?').run(r.id);
    try {
      fs.rmSync(r.base_dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

afterEach(cleanup);

describe('projects CRUD', () => {
  it('creates, lists, updates, deletes project with seed index.html', () => {
    const p = createProject({ name: NAME });
    createdIds.push(p.id);
    expect(p.id).toBeTruthy();
    expect(p.baseDir).toBeTruthy();
    expect(p.entryFile).toBe('index.html');
    expect(fs.existsSync(`${p.baseDir}/index.html`)).toBe(true);

    expect(listProjects().some((x) => x.id === p.id)).toBe(true);
    expect(getProject(p.id)?.name).toBe(NAME);

    const updated = updateProject(p.id, { name: `${NAME}_renamed` });
    expect(updated?.name).toBe(`${NAME}_renamed`);

    expect(deleteProject(p.id)).toBe(true);
    expect(getProject(p.id)).toBeUndefined();
    createdIds.pop();
  });

  it('records file revisions with cap', () => {
    const p = createProject({ name: `${NAME}_rev` });
    createdIds.push(p.id);
    for (let i = 0; i < FILE_REVISION_MAX_PER_PATH + 5; i++) {
      recordFileRevision({
        projectId: p.id,
        path: 'index.html',
        content: `v${i}`,
        source: 'user',
      });
    }
    const list = listFileRevisions(p.id, 'index.html');
    expect(list.length).toBe(FILE_REVISION_MAX_PER_PATH);
    const full = getFileRevision(list[0]!.id);
    expect(full?.content).toBeDefined();
  });

  it('preview comments and conversations', () => {
    const p = createProject({ name: `${NAME}_chat` });
    createdIds.push(p.id);
    const comment = createPreviewComment({
      projectId: p.id,
      filePath: 'index.html',
      selector: 'h1',
      body: 'Make larger',
    });
    expect(listPreviewComments(p.id).some((c) => c.id === comment.id)).toBe(true);
    expect(deletePreviewComment(comment.id)).toBe(true);

    const conv = createConversation(p.id, 'Brief');
    expect(listConversations(p.id).some((c) => c.id === conv.id)).toBe(true);
    const msg = addMessage({ conversationId: conv.id, role: 'user', content: 'Hello design' });
    expect(listMessages(conv.id).map((m) => m.id)).toContain(msg.id);
  });

  it('rejects invalid names', () => {
    expect(() => createProject({ name: '' })).toThrow(/name/i);
    expect(() => createProject({ name: 'a\nb' })).toThrow(/name/i);
  });
});

describe('projects db edge cases', () => {
  it('rejects control-char meta keys and overlong entry paths on update', () => {
    const p = createProject({ name: `${NAME}_edge` });
    createdIds.push(p.id);

    const withMeta = updateProject(p.id, {
      meta: { theme: 'light', ok: 1 },
      entryFile: 'index.html',
    });
    expect(withMeta?.meta?.theme).toBe('light');
    expect(withMeta?.entryFile).toBe('index.html');

    const cleared = updateProject(p.id, {
      designSystemId: null,
      entryFile: null,
      meta: {},
    });
    expect(cleared?.designSystemId).toBeNull();
    expect(cleared?.entryFile).toBeNull();

    expect(updateProject('no-such-project-id-xyz', { name: 'x' })).toBeUndefined();
    expect(deleteProject('no-such-project-id-xyz')).toBe(false);
  });

  it('createPreviewComment / addMessage validate inputs', () => {
    const p = createProject({ name: `${NAME}_val` });
    createdIds.push(p.id);

    expect(() =>
      createPreviewComment({
        projectId: p.id,
        filePath: '',
        selector: 'h1',
        body: 'x',
      }),
    ).toThrow();

    expect(() =>
      createPreviewComment({
        projectId: p.id,
        filePath: '../escape.html',
        selector: 'h1',
        body: 'x',
      }),
    ).toThrow(/filePath|path/i);

    expect(() =>
      createPreviewComment({
        projectId: p.id,
        filePath: 'index.html',
        selector: 'h1\n',
        body: 'x',
      }),
    ).toThrow();

    const conv = createConversation(p.id);
    expect(listConversations(p.id).some((c) => c.id === conv.id)).toBe(true);

    expect(() =>
      addMessage({ conversationId: conv.id, role: 'user', content: '' }),
    ).toThrow();

    const asst = addMessage({
      conversationId: conv.id,
      role: 'assistant',
      content: 'reply',
      agentId: 'agent-1',
    });
    expect(asst.role).toBe('assistant');
    expect(listMessages(conv.id).some((m) => m.id === asst.id)).toBe(true);

    expect(deletePreviewComment('no-such-comment')).toBe(false);
    expect(getFileRevision('no-such-rev')).toBeUndefined();
    expect(listFileRevisions(p.id).length).toBeGreaterThanOrEqual(0);
  });

  it('recordFileRevision rejects blank path / invalid project', () => {
    const p = createProject({ name: `${NAME}_rev2` });
    createdIds.push(p.id);
    expect(() =>
      recordFileRevision({
        projectId: p.id,
        path: '',
        content: 'x',
        source: 'user',
      }),
    ).toThrow();

    expect(() =>
      recordFileRevision({
        projectId: p.id,
        path: '../escape.txt',
        content: 'x',
        source: 'user',
      }),
    ).toThrow(/path/i);

    expect(() =>
      recordFileRevision({
        projectId: 'no-such',
        path: 'a.html',
        content: 'x',
        source: 'user',
      }),
    ).toThrow();

    const rev = recordFileRevision({
      projectId: p.id,
      path: '  /notes.txt  ',
      content: 'hello',
      source: 'import',
    });
    expect(rev.path).toBe('notes.txt');
    expect(getFileRevision(rev.id)?.content).toBe('hello');
    expect(listFileRevisions(p.id, 'notes.txt').some((r) => r.id === rev.id)).toBe(true);
    expect(listFileRevisions(p.id, '../escape.txt')).toEqual([]);
  });
});

describe('projects update field validation', () => {
  it('rejects invalid designSystemId and entryFile control chars', () => {
    const p = createProject({ name: `${NAME}_ds` });
    createdIds.push(p.id);

    expect(() =>
      updateProject(p.id, { designSystemId: 'ds\nid' }),
    ).toThrow(/designSystemId/i);

    expect(() =>
      updateProject(p.id, { entryFile: 'path\nhtml' }),
    ).toThrow(/entryFile/i);

    expect(() =>
      updateProject(p.id, { entryFile: '../escape.html' }),
    ).toThrow(/entryFile/i);
    expect(() =>
      updateProject(p.id, { entryFile: 'foo/../../etc/passwd' }),
    ).toThrow(/entryFile/i);

    const ok = updateProject(p.id, {
      designSystemId: '  ds-ok  ',
      entryFile: '  /nested/page.html  ',
    });
    expect(ok?.designSystemId).toBe('ds-ok');
    expect(ok?.entryFile).toBe('nested/page.html');
  });

  it('create with custom baseDir under temp projects tree', async () => {
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neos-proj-base-'));
    try {
      const p = createProject({ name: `${NAME}_basedir`, baseDir: dir });
      createdIds.push(p.id);
      expect(p.baseDir).toBe(fs.realpathSync(dir));
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});

describe('projects db hygiene edges', () => {
  it('safe lookups reject control/overlong ids and bad meta parses empty', () => {
    expect(getProject('')).toBeUndefined();
    expect(getProject('bad\nid')).toBeUndefined();
    expect(getProject('x'.repeat(200))).toBeUndefined();
    expect(deleteProject('bad\nid')).toBe(false);
    expect(listFileRevisions('bad\nid')).toEqual([]);
    expect(listFileRevisions('ok-id', 'path\n')).toEqual([]);
    expect(listPreviewComments('bad\nid')).toEqual([]);
    expect(listPreviewComments('ok-id', 'a\nb')).toEqual([]);
    expect(listConversations('')).toEqual([]);
    expect(listMessages('')).toEqual([]);
    expect(getFileRevision('')).toBeUndefined();
    expect(deletePreviewComment('')).toBe(false);

    // corrupt meta_json on a real row → parseMeta returns {}
    const p = createProject({ name: `${NAME}_meta_bad` });
    createdIds.push(p.id);
    getDb()
      .prepare('UPDATE projects SET meta_json = ? WHERE id = ?')
      .run('{not-json', p.id);
    const again = getProject(p.id);
    expect(again?.meta).toEqual({});

    getDb()
      .prepare('UPDATE projects SET meta_json = ? WHERE id = ?')
      .run(JSON.stringify(['array']), p.id);
    expect(getProject(p.id)?.meta).toEqual({});
  });

  it('recordFileRevision validates content size/null and source', () => {
    const p = createProject({ name: `${NAME}_rev_hygiene` });
    createdIds.push(p.id);

    expect(() =>
      recordFileRevision({
        projectId: p.id,
        path: 'a.html',
        content: 'x\0y',
        source: 'user',
      }),
    ).toThrow(/content/i);

    expect(() =>
      recordFileRevision({
        projectId: p.id,
        path: 'a.html',
        content: 'x'.repeat(FILE_REVISION_CONTENT_MAX + 1),
        source: 'user',
      }),
    ).toThrow(/max size/i);

    expect(() =>
      recordFileRevision({
        projectId: p.id,
        path: 'a.html',
        content: 'ok',
        source: 'nope' as never,
      }),
    ).toThrow(/source/i);

    expect(() =>
      recordFileRevision({
        projectId: '',
        path: 'a.html',
        content: 'ok',
        source: 'user',
      }),
    ).toThrow(/projectId/i);
  });

  it('preview comments and conversations validate fields', () => {
    const p = createProject({ name: `${NAME}_conv_hygiene` });
    createdIds.push(p.id);

    expect(() =>
      createPreviewComment({
        projectId: p.id,
        filePath: 'a.html',
        selector: 'h1',
        body: 'b'.repeat(PREVIEW_COMMENT_BODY_MAX + 1),
      }),
    ).toThrow(/max length/i);

    expect(() =>
      createPreviewComment({
        projectId: p.id,
        filePath: 'a\nb',
        selector: 'h1',
        body: 'x',
      }),
    ).toThrow(/filePath/i);

    expect(() => createConversation('no-such-project-id-xyz')).toThrow();
    expect(() => createConversation('bad\nid')).toThrow(/projectId/i);

    const conv = createConversation(p.id, '  title  ');
    expect(conv.title).toBe('title');

    expect(() =>
      addMessage({ conversationId: conv.id, role: 'nope' as never, content: 'x' }),
    ).toThrow(/role/i);
    expect(() =>
      addMessage({ conversationId: conv.id, role: 'user', content: 'x\0y' }),
    ).toThrow(/content/i);
    expect(() =>
      addMessage({ conversationId: conv.id, role: 'user', content: '   ' }),
    ).toThrow(/required/i);
    expect(() =>
      addMessage({ conversationId: '', role: 'user', content: 'x' }),
    ).toThrow(/conversationId/i);

    const msg = addMessage({
      conversationId: conv.id,
      role: 'system',
      content: 'note',
      agentId: 'agent-1',
    });
    expect(msg.agentId).toBe('agent-1');
    expect(listMessages(conv.id).some((m) => m.id === msg.id)).toBe(true);
  });

  it('updateProject nulls entryFile and designSystemId', () => {
    const p = createProject({
      name: `${NAME}_nulls`,
      entryFile: 'index.html',
      designSystemId: 'ds1',
    });
    createdIds.push(p.id);
    const updated = updateProject(p.id, { entryFile: null, designSystemId: null });
    expect(updated?.entryFile).toBeNull();
    expect(updated?.designSystemId).toBeNull();
  });
});
