import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from './schema.js';
import * as workflows from './workflows.js';
import {
  ARTIFACT_CONTENT_MAX_CHARS,
  ARTIFACT_FILE_PATH_MAX,
  ARTIFACT_ID_FIELD_MAX,
  ARTIFACT_NODE_ID_MAX,
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

  it('rejects oversized content on create/update', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const huge = 'x'.repeat(2 * 1024 * 1024 + 1);
    expect(() =>
      createArtifact({
        workflowId: wf.id,
        name: 'big.html',
        contentType: 'text/html',
        content: huge,
      }),
    ).toThrow(/max size/i);

    const art = createArtifact({
      workflowId: wf.id,
      name: 'ok.html',
      contentType: 'text/html',
      content: '<p>ok</p>',
    });
    expect(() => updateArtifactContent(art.id, huge)).toThrow(/max size/i);
    expect(() => updateArtifact(art.id, { content: huge })).toThrow(/max size/i);
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

  it('rejects invalid contentType on create', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    expect(() =>
      createArtifact({
        workflowId: wf.id,
        name: 'x',
        contentType: 'not-a-mime',
        content: 'x',
      }),
    ).toThrow(/contentType is invalid/i);
    expect(() =>
      createArtifact({
        workflowId: wf.id,
        name: 'x',
        contentType: 'text/ht\nml',
        content: 'x',
      }),
    ).toThrow(/contentType is invalid/i);
  });

  it('rejects blank name or contentType on create', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    expect(() =>
      createArtifact({
        workflowId: wf.id,
        name: '  ',
        contentType: 'text/html',
      }),
    ).toThrow(/workflowId, name, and contentType/i);
    expect(() =>
      createArtifact({
        workflowId: wf.id,
        name: 'x.html',
        contentType: '   ',
      }),
    ).toThrow(/workflowId, name, and contentType/i);
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

  it('normalizes contentType to lower-case', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const a = createArtifact({
      workflowId: wf.id,
      name: 'x',
      contentType: '  TEXT/HTML  ',
    });
    expect(a.contentType).toBe('text/html');
    deleteArtifact(a.id);
  });

  it('trims runId/nodeId/filePath and lists by run', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const runId = crypto.randomUUID();
    const a = createArtifact({
      workflowId: `  ${wf.id}  `,
      runId: `  ${runId}  `,
      name: '  by-run.html  ',
      contentType: 'text/html',
      content: '<p>x</p>',
      nodeId: '  n1  ',
      filePath: '  /tmp/x  ',
    });
    expect(a.runId).toBe(runId);
    expect(a.nodeId).toBe('n1');
    expect(a.filePath).toBe('/tmp/x');
    expect(a.name).toBe('by-run.html');
    expect(listArtifactsByRun(`  ${runId}  `).some((x) => x.id === a.id)).toBe(true);
    expect(listArtifactsByRun('   ')).toEqual([]);
    expect(listArtifacts('   ')).toEqual([]);
    expect(updateArtifactContent('   ', 'x')).toBeUndefined();
    expect(updateArtifact('   ', { name: 'y' })).toBeUndefined();
    expect(deleteArtifact('   ')).toBe(false);
    deleteArtifact(a.id);
  });

  it('rejects content over ARTIFACT_CONTENT_MAX_CHARS on create and update', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    const huge = 'x'.repeat(ARTIFACT_CONTENT_MAX_CHARS + 1);

    expect(() =>
      createArtifact({
        workflowId: wf.id,
        name: 'big.html',
        contentType: 'text/html',
        content: huge,
      }),
    ).toThrow(/max size/i);

    const art = createArtifact({
      workflowId: wf.id,
      name: 'ok.html',
      contentType: 'text/html',
      content: '<p>ok</p>',
    });
    expect(() => updateArtifactContent(art.id, huge)).toThrow(/max size/i);
    expect(() => updateArtifact(art.id, { content: huge })).toThrow(/max size/i);
    // original content unchanged after rejected updates
    expect(getArtifact(art.id)?.content).toBe('<p>ok</p>');

    // omitted content → DB null → undefined on read; non-string coerced via String()
    const empty = createArtifact({
      workflowId: wf.id,
      name: 'empty.html',
      contentType: 'text/html',
    });
    expect(empty.content).toBeUndefined();
    const coerced = createArtifact({
      workflowId: wf.id,
      name: 'num.html',
      contentType: 'text/html',
      content: 42 as never,
    });
    expect(coerced.content).toBe('42');
    deleteArtifact(art.id);
    deleteArtifact(empty.id);
    deleteArtifact(coerced.id);
  });

  it('rejects control-char names and overlong names', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    expect(() =>
      createArtifact({
        workflowId: wf.id,
        name: `bad${'\n'}name`,
        contentType: 'text/html',
        content: '<p>x</p>',
      }),
    ).toThrow(/control characters/i);
    expect(() =>
      createArtifact({
        workflowId: wf.id,
        name: 'a'.repeat(501),
        contentType: 'text/html',
        content: '<p>x</p>',
      }),
    ).toThrow(/max length/i);

    const art = createArtifact({
      workflowId: wf.id,
      name: 'ok.html',
      contentType: 'text/html',
      content: '<p>ok</p>',
    });
    expect(updateArtifact(art.id, { name: `bad${'\0'}x` })).toBeUndefined();
    expect(getArtifact(art.id)?.name).toBe('ok.html');
    deleteArtifact(art.id);
  });

  it('rejects null-byte content on create and update', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });
    expect(() =>
      createArtifact({
        workflowId: wf.id,
        name: 'nul.html',
        contentType: 'text/html',
        content: `hello${'\0'}world`,
      }),
    ).toThrow(/control characters/i);

    const art = createArtifact({
      workflowId: wf.id,
      name: 'ok.html',
      contentType: 'text/html',
      content: '<p>ok</p>',
    });
    expect(() => updateArtifactContent(art.id, `x${'\0'}y`)).toThrow(/control characters/i);
    expect(() => updateArtifact(art.id, { content: `x${'\0'}y` })).toThrow(/control characters/i);
    expect(getArtifact(art.id)?.content).toBe('<p>ok</p>');
    deleteArtifact(art.id);
  });

  it('rejects overlong workflowId and invalid filePath; drops bad optional ids', () => {
    const wf = workflows.createWorkflow({
      name: WF_NAME,
      domain: 'general',
      nodes: [],
      edges: [],
    });

    expect(() =>
      createArtifact({
        workflowId: 'w'.repeat(ARTIFACT_ID_FIELD_MAX + 1),
        name: 'x.html',
        contentType: 'text/html',
        content: '<p>x</p>',
      }),
    ).toThrow(/workflowId exceeds max length/i);

    expect(() =>
      createArtifact({
        workflowId: wf.id,
        name: 'path.html',
        contentType: 'text/html',
        content: '<p>x</p>',
        filePath: `bad${'\n'}path`,
      }),
    ).toThrow(/filePath is invalid/i);

    expect(() =>
      createArtifact({
        workflowId: wf.id,
        name: 'path2.html',
        contentType: 'text/html',
        content: '<p>x</p>',
        filePath: 'p'.repeat(ARTIFACT_FILE_PATH_MAX + 1),
      }),
    ).toThrow(/filePath is invalid/i);

    // Invalid optional ids → null (create still succeeds)
    const art = createArtifact({
      workflowId: wf.id,
      name: 'ids.html',
      contentType: 'text/html',
      content: '<p>x</p>',
      runId: `r${'\0'}bad`,
      nodeId: 'n'.repeat(ARTIFACT_NODE_ID_MAX + 1),
    });
    expect(art.runId).toBeUndefined();
    expect(art.nodeId).toBeUndefined();

    // overlong runId / control-char nodeId also dropped
    const art2 = createArtifact({
      workflowId: wf.id,
      name: 'ids2.html',
      contentType: 'text/html',
      content: '<p>x</p>',
      runId: 'r'.repeat(ARTIFACT_ID_FIELD_MAX + 1),
      nodeId: `n${'\n'}ode`,
    });
    expect(art2.runId).toBeUndefined();
    expect(art2.nodeId).toBeUndefined();

    // nodeId may be up to ARTIFACT_NODE_ID_MAX (graph id bound)
    const longNode = 'n'.repeat(ARTIFACT_NODE_ID_MAX);
    const kept = createArtifact({
      workflowId: wf.id,
      name: 'node-ok.html',
      contentType: 'text/html',
      content: '<p>x</p>',
      nodeId: longNode,
      runId: 'r'.repeat(ARTIFACT_ID_FIELD_MAX),
    });
    expect(kept.nodeId).toBe(longNode);
    expect(kept.runId).toBe('r'.repeat(ARTIFACT_ID_FIELD_MAX));
    deleteArtifact(art.id);
    deleteArtifact(art2.id);
    deleteArtifact(kept.id);
  });

  it('lookup helpers reject unsafe or overlong ids', () => {
    expect(listArtifacts(`wf${'\n'}id`)).toEqual([]);
    expect(listArtifacts('w'.repeat(ARTIFACT_ID_FIELD_MAX + 1))).toEqual([]);
    expect(listArtifactsByRun(`run${'\0'}id`)).toEqual([]);
    expect(listArtifactsByRun('r'.repeat(ARTIFACT_ID_FIELD_MAX + 1))).toEqual([]);
    expect(getArtifact(`id${'\n'}x`)).toBeUndefined();
    expect(getArtifact('i'.repeat(ARTIFACT_ID_FIELD_MAX + 1))).toBeUndefined();
    expect(deleteArtifact(`id${'\0'}x`)).toBe(false);
    expect(updateArtifactContent('i'.repeat(ARTIFACT_ID_FIELD_MAX + 1), 'x')).toBeUndefined();
    expect(updateArtifact(`id${'\r'}x`, { name: 'y' })).toBeUndefined();
  });
});

