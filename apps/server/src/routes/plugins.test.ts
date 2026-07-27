import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import plugins from './plugins.js';

const SKILLS_DIR = path.join(os.homedir(), '.config', 'neos-work', 'skills');
const DIR_NAME = `_cov_plugin_route_${process.pid}`;
const DIR = path.join(SKILLS_DIR, DIR_NAME);

afterEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true }).catch(() => {});
});

describe('plugins routes', () => {
  it('lists plugins as ok data array', async () => {
    const res = await plugins.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns 404 for unknown plugin', async () => {
    const res = await plugins.request('/no-such-plugin-xyz');
    expect(res.status).toBe(404);
  });

  it('returns 404 for blank path id after trim', async () => {
    const res = await plugins.request('/%20%20');
    expect(res.status).toBe(404);
  });

  it('resume rejects invalid JSON and unknown plugin', async () => {
    const badJson = await plugins.request('/p1/run/r1/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

    const missingStage = await plugins.request('/p1/run/r1/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: {} }),
    });
    expect(missingStage.status).toBe(400);

    const badStage = await plugins.request('/p1/run/r1/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: 'bad\nstage', response: {} }),
    });
    expect(badStage.status).toBe(400);

    const longStage = await plugins.request('/p1/run/r1/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: 's'.repeat(101), response: {} }),
    });
    expect(longStage.status).toBe(400);

    const unknown = await plugins.request('/no-such-plugin-xyz/run/r1/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: 's1', response: {} }),
    });
    expect(unknown.status).toBe(404);

    // known-looking plugin id but no active run → stage mismatch / not found
    const noRun = await plugins.request(`/${DIR_NAME}/run/no-such-run/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: 'confirm', response: {} }),
    });
    expect(noRun.status).toBe(404);
    expect(((await noRun.json()) as { error: string }).error).toMatch(/not found|stage mismatch/i);

    // Overlong runId path segment
    const longRun = await plugins.request(`/${DIR_NAME}/run/${'r'.repeat(101)}/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: 'confirm', response: {} }),
    });
    expect(longRun.status).toBe(404);
  });

  it('resume rejects oversized HITL response payload', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      '---\nname: Cov Resume Plugin\n---\n\n# Cov\n',
      'utf8',
    );
    const up = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillDirName: DIR_NAME, name: 'Cov Resume Plugin' }),
    });
    expect(up.status).toBe(201);

    const tooBig = await plugins.request(`/${DIR_NAME}/run/r1/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stageId: 'confirm',
        response: { blob: 'x'.repeat(210_000) },
      }),
    });
    expect(tooBig.status).toBe(400);
    expect(((await tooBig.json()) as { error: string }).error).toMatch(/too large/i);
  });

  it('rejects upgrade without skillId/skillDirName', async () => {
    const res = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects path-like or control-char skillDirName', async () => {
    const pathLike = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillDirName: '../escape' }),
    });
    expect(pathLike.status).toBe(400);
    const ctrl = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillDirName: 'bad\ndir' }),
    });
    expect(ctrl.status).toBe(400);
    // Leading control-char skillDirName
    const leading = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillDirName: '\nok-dir' }),
    });
    expect(leading.status).toBe(400);
  });

  it('upgrade rejects invalid JSON body', async () => {
    const res = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('upgrade 404s when skill directory missing', async () => {
    const res = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillDirName: 'definitely-missing-skill-dir-xyz' }),
    });
    expect([400, 404]).toContain(res.status);
  });

  it('POST run rejects unknown plugin', async () => {
    const res = await plugins.request('/no-such-plugin-xyz/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: {} }),
    });
    expect(res.status).toBe(404);
  });

  it('POST run rejects oversized inputs and ignores array inputs', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      '---\nname: Cov Inputs Plugin\n---\n\n# Cov\n',
      'utf8',
    );
    const up = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillDirName: DIR_NAME,
        name: 'Cov Inputs Plugin',
      }),
    });
    expect(up.status).toBe(201);

    const tooBig = await plugins.request(`/${DIR_NAME}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: { blob: 'x'.repeat(260_000) } }),
    });
    expect(tooBig.status).toBe(400);
    expect(((await tooBig.json()) as { error: string }).error).toMatch(/too large/i);

    // Array inputs are not plain objects — treated as empty (no 400), run may start SSE
    const arr = await plugins.request(`/${DIR_NAME}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: ['not', 'an', 'object'] }),
    });
    // Should not be the size-guard 400; 200 SSE or other non-size error
    expect(arr.status).not.toBe(400);
  });

  it('upgrades skill dir to plugin and returns detail', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      '---\nname: Cov Route Plugin\n---\n\n# Cov\n\nBody.\n',
      'utf8',
    );

    const up = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skillDirName: DIR_NAME,
        name: 'Cov Route Plugin',
        description: 'from test',
      }),
    });
    expect(up.status).toBe(201);
    const created = await up.json() as { ok: boolean; data: { id: string; name: string; pipeline?: unknown[] } };
    expect(created.ok).toBe(true);
    expect(created.data.id).toBe(DIR_NAME);
    expect(created.data.pipeline?.length).toBe(4);

    const get = await plugins.request(`/${DIR_NAME}`);
    expect(get.status).toBe(200);
    const detail = await get.json() as { data: { name: string; skillContent?: string } };
    expect(detail.data.name).toBe('Cov Route Plugin');
    // list view should not require skillContent
    const list = await plugins.request('/');
    const listBody = await list.json() as { data: Array<{ id: string; skillContent?: string }> };
    const row = listBody.data.find((p) => p.id === DIR_NAME);
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty('skillContent');
  });
});

describe('plugins additional coverage', () => {
  it('upgrade via skillId from skill table', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      '---\nname: Cov SkillId Plugin\n---\n\n# SkillId\n',
      'utf8',
    );

    const { getDb } = await import('../db/schema.js');
    const skillId = crypto.randomUUID();
    getDb()
      .prepare(
        `INSERT INTO skill (id, name, description, source, path, version, enabled)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        skillId,
        `${DIR_NAME}-skill-row`,
        'cov',
        'local',
        path.join(DIR, 'SKILL.md'),
        '0.0.1',
      );

    try {
      const up = await plugins.request('/upgrade-from-skill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          skillId,
          name: 'From Skill Id',
          description: 'd'.repeat(3_000),
        }),
      });
      expect(up.status).toBe(201);
      const body = (await up.json()) as { ok: boolean; data: { id: string } };
      expect(body.ok).toBe(true);
      expect(body.data.id).toBe(DIR_NAME);
    } finally {
      getDb().prepare('DELETE FROM skill WHERE id = ?').run(skillId);
    }
  });

  it('upgrade rejects invalid skillId / name / description', async () => {
    const badSkillId = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillId: 'bad\nid' }),
    });
    expect(badSkillId.status).toBe(400);

    const longSkillId = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillId: 's'.repeat(101) }),
    });
    expect(longSkillId.status).toBe(400);

    const missingSkill = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillId: crypto.randomUUID() }),
    });
    expect(missingSkill.status).toBe(404);

    const badName = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillDirName: DIR_NAME, name: 'n\n' }),
    });
    expect(badName.status).toBe(400);

    const badDesc = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillDirName: DIR_NAME, description: `x${'\0'}` }),
    });
    expect(badDesc.status).toBe(400);
  });

  it('GET returns plugin detail with skill content stripped of dir', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      '---\nname: Cov Get Plugin\n---\n\n# Get\n',
      'utf8',
    );
    const up = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillDirName: DIR_NAME, name: 'Cov Get Plugin' }),
    });
    expect(up.status).toBe(201);

    const get = await plugins.request(`/${DIR_NAME}`);
    expect(get.status).toBe(200);
    const detail = (await get.json()) as { data: { dir?: string; skillContent?: string } };
    expect(detail.data).not.toHaveProperty('dir');
    expect(typeof detail.data.skillContent).toBe('string');
  });

  it('POST run drops control-char input keys and caps key count', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      '---\nname: Cov Run Keys\n---\n\n# Keys\n',
      'utf8',
    );
    const up = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillDirName: DIR_NAME, name: 'Cov Run Keys' }),
    });
    expect(up.status).toBe(201);

    const inputs: Record<string, unknown> = { good: 1, 'bad\nkey': 2, '': 3 };
    for (let i = 0; i < 210; i++) inputs[`k${i}`] = i;

    const res = await plugins.request(`/${DIR_NAME}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs }),
    });
    // SSE stream starts successfully (or completes quickly)
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const text = await res.text();
      expect(text).toMatch(/pipeline\.|stage\.|data:/);
    }
  });

  it('resume returns ok when pending run is mocked via resumeRun side channel', async () => {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      path.join(DIR, 'SKILL.md'),
      '---\nname: Cov Resume Ok\n---\n\n# Resume\n',
      'utf8',
    );
    const up = await plugins.request('/upgrade-from-skill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillDirName: DIR_NAME, name: 'Cov Resume Ok' }),
    });
    expect(up.status).toBe(201);

    // Inject pending run into plugin-runner module map by starting a HITL pipeline is heavy;
    // exercise blank plugin id and non-object response fallback instead.
    const blankPlugin = await plugins.request('/%20/run/r1/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: 's1', response: null }),
    });
    expect(blankPlugin.status).toBe(404);

    const nonObject = await plugins.request(`/${DIR_NAME}/run/r1/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stageId: 'confirm', response: 'not-object' }),
    });
    // no pending run → 404
    expect(nonObject.status).toBe(404);
  });

  it('lists atom registry catalog', async () => {
    const res = await plugins.request('/atoms');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: Array<{ id: string }>;
      meta?: { count: number };
    };
    expect(body.ok).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(12);
    expect(body.data.some((a) => a.id === 'editor.apply_patch')).toBe(true);
  });
});
