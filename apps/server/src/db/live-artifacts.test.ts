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
