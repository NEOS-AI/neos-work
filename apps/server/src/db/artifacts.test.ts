import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from './schema.js';
import * as workflows from './workflows.js';
import {
  createArtifact,
  deleteArtifact,
  getArtifact,
  listArtifacts,
  listArtifactsByRun,
  updateArtifactContent,
  updateArtifact,
} from './artifacts.js';

const WF_NAME = `_cov_art_${process.pid}`;

function cleanup() {
  const db = getDb();
  const rows = db.prepare('SELECT id FROM workflow WHERE name = ?').all(WF_NAME) as Array<{ id: string }>;
  for (const r of rows) {
    db.prepare('DELETE FROM artifacts WHERE workflow_id = ?').run(r.id);
    db.prepare('DELETE FROM workflow WHERE id = ?').run(r.id);
  }
}

afterEach(cleanup);

describe('artifacts CRUD', () => {
  it('creates, lists, updates, and deletes artifacts', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const runId = crypto.randomUUID();
    const art = createArtifact({
      workflowId: wf.id,
      runId,
      name: 'preview.html',
      contentType: 'text/html',
      content: '<html><body>hi</body></html>',
      nodeId: 'agent-1',
    });
    expect(art.id).toBeTruthy();
    expect(art.workflowId).toBe(wf.id);
    expect(art.content).toContain('hi');
    expect(art.nodeId).toBe('agent-1');

    expect(listArtifacts(wf.id).some((a) => a.id === art.id)).toBe(true);
    expect(listArtifactsByRun(runId).some((a) => a.id === art.id)).toBe(true);

    const updated = updateArtifactContent(art.id, '<html>updated</html>');
    expect(updated?.content).toContain('updated');
    expect(getArtifact(art.id)?.content).toContain('updated');

    expect(deleteArtifact(art.id)).toBe(true);
    expect(getArtifact(art.id)).toBeUndefined();
    expect(deleteArtifact(art.id)).toBe(false);
  });

  it('lists empty for unknown workflow', () => {
    expect(listArtifacts('no-such-workflow')).toEqual([]);
  });

  it('trims ids and returns empty/undefined for blank ids', () => {
    expect(getArtifact('   ')).toBeUndefined();
    expect(listArtifacts('   ')).toEqual([]);
    expect(listArtifactsByRun('   ')).toEqual([]);
    expect(deleteArtifact('   ')).toBe(false);
    expect(() =>
      createArtifact({
        workflowId: '   ',
        name: 'x',
        contentType: 'text/html',
      }),
    ).toThrow(/workflowId/i);
  });
});

describe('updateArtifact PATCH semantics', () => {
  it('renames without changing content', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const art = createArtifact({
      workflowId: wf.id,
      name: 'old.html',
      contentType: 'text/html',
      content: '<html>x</html>',
    });
    const updated = updateArtifact(art.id, { name: 'new.html' });
    expect(updated?.name).toBe('new.html');
    expect(updated?.content).toBe('<html>x</html>');
  });

  it('updates content without changing name', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const art = createArtifact({
      workflowId: wf.id,
      name: 'page.html',
      contentType: 'text/html',
      content: '<html>old</html>',
    });
    const updated = updateArtifact(art.id, { content: '<html>new</html>' });
    expect(updated?.name).toBe('page.html');
    expect(updated?.content).toBe('<html>new</html>');
  });

  it('updates name and content together', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const art = createArtifact({
      workflowId: wf.id,
      name: 'a.html',
      contentType: 'text/html',
      content: 'a',
    });
    const updated = updateArtifact(art.id, { name: 'b.html', content: 'b' });
    expect(updated?.name).toBe('b.html');
    expect(updated?.content).toBe('b');
  });

  it('returns undefined for missing id', () => {
    expect(updateArtifact('missing-id', { name: 'x' })).toBeUndefined();
  });
});

