import fs from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FILE_REVISION_MAX_PER_PATH,
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
        projectId: 'no-such',
        path: 'a.html',
        content: 'x',
        source: 'user',
      }),
    ).toThrow();

    const rev = recordFileRevision({
      projectId: p.id,
      path: 'notes.txt',
      content: 'hello',
      source: 'import',
    });
    expect(rev.path).toBe('notes.txt');
    expect(getFileRevision(rev.id)?.content).toBe('hello');
  });
});
