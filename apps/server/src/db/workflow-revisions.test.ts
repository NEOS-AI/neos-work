import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from './schema.js';
import { createRevision, listRevisions } from './workflow-revisions.js';
import * as workflows from './workflows.js';

const WF_NAME = `_cov_rev_${process.pid}`;

function cleanup() {
  const db = getDb();
  const rows = db.prepare("SELECT id FROM workflow WHERE name = ?").all(WF_NAME) as Array<{ id: string }>;
  for (const r of rows) {
    db.prepare('DELETE FROM workflow_revisions WHERE workflow_id = ?').run(r.id);
    db.prepare('DELETE FROM workflow WHERE id = ?').run(r.id);
  }
}

afterEach(cleanup);

describe('createRevision dedup', () => {
  it('skips identical consecutive snapshots', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const snap = JSON.stringify({ name: WF_NAME, nodes: [], edges: [] });
    const a = createRevision(wf.id, snap, 'first');
    expect(a).not.toBeNull();
    const b = createRevision(wf.id, snap, 'dup');
    expect(b).toBeNull();
    const list = listRevisions(wf.id);
    expect(list).toHaveLength(1);
  });

  it('creates a new revision when snapshot changes', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const a = createRevision(wf.id, JSON.stringify({ n: 1 }));
    const b = createRevision(wf.id, JSON.stringify({ n: 2 }));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(listRevisions(wf.id)).toHaveLength(2);
  });
});
