import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as projects from './projects.js';
import {
  createLiveArtifact,
  deleteLiveArtifact,
  getLiveArtifact,
  listLiveArtifactRefreshes,
  listLiveArtifacts,
  refreshLiveArtifact,
  renderLiveTemplate,
  updateLiveArtifact,
} from './live-artifacts.js';
import { getDb } from './schema.js';

const NAME = `_live_art_${process.pid}`;
const ids: string[] = [];

afterEach(() => {
  const db = getDb();
  for (const id of [...ids, ...((db
    .prepare('SELECT id FROM projects WHERE name LIKE ?')
    .all(`${NAME}%`) as Array<{ id: string }>).map((r) => r.id))]) {
    const row = db.prepare('SELECT base_dir FROM projects WHERE id = ?').get(id) as
      | { base_dir: string }
      | undefined;
    db.prepare('DELETE FROM live_artifact_refreshes WHERE artifact_id IN (SELECT id FROM live_artifacts WHERE project_id = ?)').run(id);
    db.prepare('DELETE FROM live_artifacts WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (row?.base_dir) {
      try {
        fs.rmSync(row.base_dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
  ids.length = 0;
});

describe('live-artifacts db', () => {
  it('renderLiveTemplate substitutes keys', () => {
    expect(renderLiveTemplate('Hi {{name}}!', { name: 'Ada' })).toBe('Hi Ada!');
    expect(renderLiveTemplate('{{missing}}', {})).toBe('');
  });

  it('CRUD + refresh + sidecar', () => {
    const p = projects.createProject({ name: NAME });
    ids.push(p.id);

    const art = createLiveArtifact({
      projectId: p.id,
      name: 'Greeting',
      sourceTemplate: '<h1>Hello {{who}}</h1>',
      inputs: { who: 'World' },
    });
    expect(art.content).toBe('<h1>Hello World</h1>');
    expect(art.sidecarPath).toMatch(/\.neos-work\/live-artifacts\//);
    const abs = path.join(p.baseDir, art.sidecarPath!);
    expect(fs.existsSync(abs)).toBe(true);

    const listed = listLiveArtifacts(p.id);
    expect(listed.some((a) => a.id === art.id)).toBe(true);

    const updated = updateLiveArtifact(art.id, p.id, {
      inputs: { who: 'NEOS' },
    });
    expect(updated?.content).toBe('<h1>Hello NEOS</h1>');

    const refreshed = refreshLiveArtifact(art.id, p.id, { who: 'Again' });
    expect(refreshed.artifact.content).toContain('Again');
    expect(refreshed.refresh.status).toBe('succeeded');
    expect(listLiveArtifactRefreshes(art.id).length).toBeGreaterThanOrEqual(1);

    expect(deleteLiveArtifact(art.id, p.id)).toBe(true);
    expect(getLiveArtifact(art.id, p.id)).toBeNull();
    expect(fs.existsSync(abs)).toBe(false);
  });

  it('delete ignores absolute/escaped sidecar paths (no outside unlink)', () => {
    const p = projects.createProject({ name: `${NAME}_esc` });
    ids.push(p.id);
    const art = createLiveArtifact({
      projectId: p.id,
      name: 'Trap',
      sourceTemplate: 'x',
    });
    const marker = path.join(os.tmpdir(), `neos-sidecar-marker-${process.pid}.txt`);
    fs.writeFileSync(marker, 'keep', 'utf8');
    try {
      getDb()
        .prepare('UPDATE live_artifacts SET sidecar_path = ? WHERE id = ?')
        .run(marker, art.id);
      expect(deleteLiveArtifact(art.id, p.id)).toBe(true);
      expect(fs.existsSync(marker)).toBe(true);

      // relative traversal also ignored
      const art2 = createLiveArtifact({
        projectId: p.id,
        name: 'Trap2',
        sourceTemplate: 'y',
      });
      getDb()
        .prepare('UPDATE live_artifacts SET sidecar_path = ? WHERE id = ?')
        .run('../../outside.txt', art2.id);
      expect(deleteLiveArtifact(art2.id, p.id)).toBe(true);
      expect(fs.existsSync(marker)).toBe(true);
    } finally {
      fs.rmSync(marker, { force: true });
    }
  });

  it('rejects cross-project get', () => {
    const a = projects.createProject({ name: `${NAME}_a` });
    const b = projects.createProject({ name: `${NAME}_b` });
    ids.push(a.id, b.id);
    const art = createLiveArtifact({
      projectId: a.id,
      name: 'X',
      sourceTemplate: 't',
    });
    expect(getLiveArtifact(art.id, b.id)).toBeNull();
  });
});

describe('live-artifacts db edge cases', () => {
  it('rejects invalid name/project and null-byte template', () => {
    const p = projects.createProject({ name: `${NAME}_edge` });
    ids.push(p.id);
    expect(() =>
      createLiveArtifact({ projectId: '', name: 'x' }),
    ).toThrow(/projectId/i);
    expect(() =>
      createLiveArtifact({ projectId: p.id, name: '' }),
    ).toThrow(/name/i);
    expect(() =>
      createLiveArtifact({
        projectId: p.id,
        name: 'bad',
        sourceTemplate: 'hi\0there',
      }),
    ).toThrow(/control/i);
  });

  it('supports contentType, writeSidecar false, null template clear', () => {
    const p = projects.createProject({ name: `${NAME}_side` });
    ids.push(p.id);
    const art = createLiveArtifact({
      projectId: p.id,
      name: 'Plain',
      sourceTemplate: 'hello {{x}}',
      inputs: { x: 'world', 'bad\nkey': 1 },
      contentType: 'text/plain',
      writeSidecar: false,
    });
    expect(art.contentType).toBe('text/plain');
    expect(art.sidecarPath).toBeNull();
    expect(art.content).toBe('hello world');

    const cleared = updateLiveArtifact(art.id, p.id, { sourceTemplate: null });
    expect(cleared?.sourceTemplate).toBeNull();
    expect(cleared?.content).toBeNull();

    expect(() =>
      refreshLiveArtifact(art.id, p.id),
    ).toThrow(/sourceTemplate is required/i);
  });

  it('renderLiveTemplate stringifies objects and drops nulls', () => {
    expect(renderLiveTemplate('{{obj}}', { obj: { a: 1 } })).toBe('{"a":1}');
    expect(renderLiveTemplate('{{n}}', { n: null })).toBe('');
    expect(renderLiveTemplate('{{s}}', { s: 'a\0b' })).toBe('ab');
  });

  it('list returns empty for bad project id; refresh history list limits', () => {
    expect(listLiveArtifacts('')).toEqual([]);
    expect(listLiveArtifactRefreshes('')).toEqual([]);
    const p = projects.createProject({ name: `${NAME}_lim` });
    ids.push(p.id);
    const art = createLiveArtifact({
      projectId: p.id,
      name: 'R',
      sourceTemplate: '{{n}}',
      inputs: { n: 1 },
    });
    for (let i = 0; i < 3; i++) {
      refreshLiveArtifact(art.id, p.id, { n: i });
    }
    expect(listLiveArtifactRefreshes(art.id, 2).length).toBe(2);
    expect(listLiveArtifactRefreshes(art.id, 0).length).toBeGreaterThanOrEqual(1);
  });

  it('update rejects invalid name and control template', () => {
    const p = projects.createProject({ name: `${NAME}_upd` });
    ids.push(p.id);
    const art = createLiveArtifact({
      projectId: p.id,
      name: 'U',
      sourceTemplate: 't',
    });
    expect(() => updateLiveArtifact(art.id, p.id, { name: '' })).toThrow(/name/i);
    expect(() =>
      updateLiveArtifact(art.id, p.id, { sourceTemplate: 'x\0y' }),
    ).toThrow(/control/i);
    expect(updateLiveArtifact('missing', p.id, { name: 'z' })).toBeNull();
  });

  it('rejects oversized inputs', () => {
    const p = projects.createProject({ name: `${NAME}_big` });
    ids.push(p.id);
    const big = { data: 'x'.repeat(300_000) };
    expect(() =>
      createLiveArtifact({
        projectId: p.id,
        name: 'Big',
        sourceTemplate: 't',
        inputs: big,
      }),
    ).toThrow(/inputs exceed/i);
  });
});
