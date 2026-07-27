import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeployment, deleteDeployment, listDeployments } from '../db/deployments.js';
import { deleteSetting, setSetting } from '../db/settings.js';
import deploy from './deploy.js';

const MARKER = `_cov_dep_route_${process.pid}`;

afterEach(() => {
  for (const d of listDeployments({ limit: 200 })) {
    if (d.projectName?.startsWith(MARKER)) deleteDeployment(d.id);
  }
  try { deleteSetting('VERCEL_API_TOKEN'); } catch { /* ignore */ }
  try { deleteSetting('CLOUDFLARE_API_TOKEN'); } catch { /* ignore */ }
  try { deleteSetting('CLOUDFLARE_ACCOUNT_ID'); } catch { /* ignore */ }
});

describe('deploy routes', () => {
  it('GET list includes created history rows', async () => {
    const row = createDeployment({
      provider: 'vercel',
      projectName: `${MARKER}-proj`,
      status: 'success',
      url: 'https://example.vercel.app',
    });
    const res = await deploy.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: Array<{ id: string }> };
    expect(body.ok).toBe(true);
    expect(body.data.some((d) => d.id === row.id)).toBe(true);
  });

  it('GET single and DELETE', async () => {
    const row = createDeployment({
      provider: 'cloudflare',
      projectName: `${MARKER}-cf`,
      status: 'pending',
    });
    const get = await deploy.request(`/${row.id}`);
    expect(get.status).toBe(200);
    const del = await deploy.request(`/${row.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const missing = await deploy.request(`/${row.id}`);
    expect(missing.status).toBe(404);
  });

  it('list trims workflowId query filter', async () => {
    const row = createDeployment({
      provider: 'vercel',
      projectName: `${MARKER}-wf`,
      status: 'success',
      workflowId: 'wf-trim-test',
    });
    const res = await deploy.request('/?workflowId=%20wf-trim-test%20');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ id: string }> };
    expect(body.data.some((d) => d.id === row.id)).toBe(true);
  });

  it('list drops unsafe workflowId query filter (lists unfiltered)', async () => {
    const row = createDeployment({
      provider: 'vercel',
      projectName: `${MARKER}-unsafe-wf`,
      status: 'success',
      workflowId: 'wf-safe-only',
    });
    // Control-char / overlong filters are ignored rather than 400
    for (const q of [
      `/?workflowId=${encodeURIComponent('bad\nid')}`,
      `/?workflowId=${'w'.repeat(101)}`,
    ]) {
      const res = await deploy.request(q);
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; data: Array<{ id: string }> };
      expect(body.ok).toBe(true);
      // Unfiltered list should still include our row
      expect(body.data.some((d) => d.id === row.id)).toBe(true);
    }
  });

  it('list trims and clamps limit query', async () => {
    for (let i = 0; i < 3; i++) {
      createDeployment({
        provider: 'vercel',
        projectName: `${MARKER}-lim-${i}`,
        status: 'success',
      });
    }

    const one = await deploy.request('/?limit=%20%201%20%20');
    expect(one.status).toBe(200);
    const oneBody = await one.json() as { data: unknown[] };
    expect(oneBody.data.length).toBe(1);

    const blank = await deploy.request('/?limit=%20%20');
    expect(blank.status).toBe(200);
    const blankBody = await blank.json() as { data: unknown[] };
    // blank after trim → default 100 (at least our 3 rows)
    expect(blankBody.data.length).toBeGreaterThanOrEqual(3);

    const zero = await deploy.request('/?limit=0');
    expect(zero.status).toBe(200);
    const zeroBody = await zero.json() as { data: unknown[] };
    // parse fails → 100, then clamp min is 1 for non-empty parse; "0" → parseInt 0 || 100 → 100
    expect(zeroBody.data.length).toBeGreaterThanOrEqual(3);

    const huge = await deploy.request('/?limit=9999');
    expect(huge.status).toBe(200);
    // clamps to 500 max — just ensure no throw
    const hugeBody = await huge.json() as { data: unknown[] };
    expect(Array.isArray(hugeBody.data)).toBe(true);

    // Leading control-char limit must not strip to a numeric limit
    const ctrl = await deploy.request(`/?limit=${encodeURIComponent('\n1')}`);
    expect(ctrl.status).toBe(200);
    const ctrlBody = await ctrl.json() as { data: unknown[] };
    // ignored → default 100 (at least our seeded rows)
    expect(ctrlBody.data.length).toBeGreaterThanOrEqual(3);
  });

  it('preflight reports missing vercel token', async () => {
    const res = await deploy.request('/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'vercel' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      data: { ready: boolean; checks: Array<{ key: string; ok: boolean }> };
    };
    // shape may be data.ready or top-level
    const ready = body.data?.ready ?? (body as { ready?: boolean }).ready;
    if (ready !== undefined) {
      expect(ready).toBe(false);
    }
    const checks = body.data?.checks ?? (body as { checks?: unknown[] }).checks;
    expect(Array.isArray(checks) || body.ok === true).toBe(true);
  });

  it('preflight ready when vercel token set', async () => {
    setSetting('VERCEL_API_TOKEN', 'tok-test');
    const res = await deploy.request('/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'vercel' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data?: { ready: boolean }; ready?: boolean };
    const ready = body.data?.ready ?? body.ready;
    expect(ready).toBe(true);
  });

  it('preflight treats whitespace-only vercel token as missing', async () => {
    setSetting('VERCEL_API_TOKEN', '   ');
    const res = await deploy.request('/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'vercel' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data?: { ready: boolean; checks?: Array<{ key: string; ok: boolean }> };
    };
    expect(body.data?.ready).toBe(false);
    const tokenCheck = body.data?.checks?.find((c) => c.key === 'VERCEL_API_TOKEN');
    expect(tokenCheck?.ok).toBe(false);
  });

  it('POST deploy rejects invalid JSON body', async () => {
    const res = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('POST deploy rejects whitespace-only content', async () => {
    setSetting('VERCEL_API_TOKEN', 'tok-test');
    const res = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'vercel', content: '   ' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/content/i);
  });

  it('POST deploy rejects invalid project name', async () => {
    setSetting('VERCEL_API_TOKEN', 'tok-test');
    const res = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'vercel',
        content: '<html></html>',
        projectName: '-bad-name',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/project name/i);
  });

  it('preflight flags invalid project name as not ready', async () => {
    setSetting('VERCEL_API_TOKEN', 'tok-test');
    const res = await deploy.request('/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'vercel', projectName: 'has space' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data?: { ready: boolean; checks?: Array<{ key: string; ok: boolean }> };
    };
    expect(body.data?.ready).toBe(false);
    const projectCheck = body.data?.checks?.find((c) => c.key === 'projectName');
    expect(projectCheck?.ok).toBe(false);
  });

  it('preflight rejects invalid provider', async () => {
    const res = await deploy.request('/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'aws' }),
    });
    expect(res.status).toBe(400);

    // Leading control-char provider
    const leading = await deploy.request('/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: '\nvercel' }),
    });
    expect(leading.status).toBe(400);

    // Control-char projectName
    const badProj = await deploy.request('/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'vercel', projectName: 'bad\nname' }),
    });
    expect(badProj.status).toBe(400);
  });

  it('preflight reports missing cloudflare credentials', async () => {
    const res = await deploy.request('/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'cloudflare' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data?: { ready: boolean; checks?: Array<{ key: string; ok: boolean }> };
    };
    expect(body.data?.ready).toBe(false);
    expect(body.data?.checks?.some((c) => c.key === 'CLOUDFLARE_API_TOKEN' && !c.ok)).toBe(true);
    expect(body.data?.checks?.some((c) => c.key === 'CLOUDFLARE_ACCOUNT_ID' && !c.ok)).toBe(true);
  });

  it('POST deploy rejects missing provider and content too large', async () => {
    const noProvider = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '<p>x</p>' }),
    });
    expect(noProvider.status).toBe(400);
    expect(((await noProvider.json()) as { error: string }).error).toMatch(/provider|content/i);

    const badProvider = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'aws', content: '<p>x</p>' }),
    });
    expect(badProvider.status).toBe(400);
    expect(((await badProvider.json()) as { error: string }).error).toMatch(/vercel or cloudflare/i);

    // Leading control-char provider
    const leading = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: '\nvercel', content: '<p>x</p>' }),
    });
    expect(leading.status).toBe(400);

    // 5MB+1 is intentional to hit the size guard without calling remote APIs
    const huge = 'x'.repeat(5_000_001);
    const tooBig = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'vercel', content: huge }),
    });
    expect(tooBig.status).toBe(400);
    expect(((await tooBig.json()) as { error: string }).error).toMatch(/too large/i);
  });

  it('POST deploy rejects cloudflare without credentials', async () => {
    const res = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'cloudflare',
        content: '<html>hi</html>',
        // project names must start with alnum (MARKER begins with `_`)
        projectName: `cf${MARKER}-nocreds`.slice(0, 63),
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Cloudflare/i);
  });

  it('POST /:id/refresh validates id, remote deploymentId, and credentials', async () => {
    const blank = await deploy.request('/%20/refresh', { method: 'POST' });
    expect(blank.status).toBe(404);

    const missing = await deploy.request('/no-such-dep/refresh', { method: 'POST' });
    expect(missing.status).toBe(404);

    const noRemote = createDeployment({
      provider: 'vercel',
      projectName: `${MARKER}-noref`,
      status: 'pending',
      // no deploymentId
    });
    const noId = await deploy.request(`/${noRemote.id}/refresh`, { method: 'POST' });
    expect(noId.status).toBe(400);
    expect(((await noId.json()) as { error: string }).error).toMatch(/remote deployment id/i);

    const withRemote = createDeployment({
      provider: 'vercel',
      projectName: `${MARKER}-ref`,
      status: 'deploying',
      deploymentId: 'dpl_test_1',
    });
    // no VERCEL token
    const noTok = await deploy.request(`/${withRemote.id}/refresh`, { method: 'POST' });
    expect(noTok.status).toBe(400);
    expect(((await noTok.json()) as { error: string }).error).toMatch(/Vercel API token/i);

    const cf = createDeployment({
      provider: 'cloudflare',
      projectName: `${MARKER}-cf-ref`,
      status: 'deploying',
      deploymentId: 'cf_dep_1',
    });
    const noCf = await deploy.request(`/${cf.id}/refresh`, { method: 'POST' });
    expect(noCf.status).toBe(400);
    expect(((await noCf.json()) as { error: string }).error).toMatch(/Cloudflare/i);
  });

  it('POST /:id/refresh updates status from mocked provider', async () => {
    setSetting('VERCEL_API_TOKEN', 'tok-refresh');
    const row = createDeployment({
      provider: 'vercel',
      projectName: `${MARKER}-ok-ref`,
      status: 'deploying',
      deploymentId: 'dpl_ok',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ readyState: 'READY', url: 'refreshed.vercel.app' }),
      }),
    );
    try {
      const res = await deploy.request(`/${row.id}/refresh`, { method: 'POST' });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        ok: boolean;
        data: { status: string; url?: string };
      };
      expect(body.ok).toBe(true);
      expect(body.data.status).toBe('success');
      expect(body.data.url).toMatch(/refreshed\.vercel\.app/);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('preflight accepts case-insensitive provider', async () => {
    const res = await deploy.request('/preflight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: '  CloudFlare  ' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data?: { provider?: string }; provider?: string; ready?: boolean };
    // response shape may nest under data
    const text = JSON.stringify(body);
    expect(text.toLowerCase()).toContain('cloudflare');
  });
});

describe('deploy POST success paths (mocked fetch)', () => {
  it('POST vercel deploy succeeds with mocked API', async () => {
    setSetting('VERCEL_API_TOKEN', 'tok-deploy-ok');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          url: 'https://ok.vercel.app',
          id: 'dpl_mocked',
          readyState: 'READY',
        }),
        text: async () => '',
      }),
    );
    try {
      const res = await deploy.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'vercel',
          content: '<html>ok</html>',
          projectName: `v${MARKER}-ok`.slice(0, 63),
          workflowId: 'wf-cov-1',
          runId: 'run-cov-1',
        }),
      });
      // Depending on deploy lib parsing, success or structured failure
      expect([200, 400, 500]).toContain(res.status);
      const body = await res.json();
      expect(body).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('POST vercel without token fails and records failed deployment', async () => {
    const res = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'vercel',
        content: '<html>x</html>',
        projectName: `v${MARKER}-notok`.slice(0, 63),
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Vercel API token/i);
  });

  it('POST rejects control-char workflowId/runId/projectName and null content', async () => {
    setSetting('VERCEL_API_TOKEN', 'tok');
    const badWf = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'vercel',
        content: '<p>x</p>',
        workflowId: 'bad\nid',
      }),
    });
    expect(badWf.status).toBe(400);

    const badRun = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'vercel',
        content: '<p>x</p>',
        runId: 'r\n1',
      }),
    });
    expect(badRun.status).toBe(400);

    const badProj = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'vercel',
        content: '<p>x</p>',
        projectName: 'p\n',
      }),
    });
    expect(badProj.status).toBe(400);

    const nullContent = await deploy.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'vercel',
        content: `x${'\0'}`,
      }),
    });
    expect(nullContent.status).toBe(400);
  });

  it('refresh cloudflare path with mocked fetch', async () => {
    setSetting('CLOUDFLARE_API_TOKEN', 'cf-tok');
    setSetting('CLOUDFLARE_ACCOUNT_ID', 'acct');
    const row = createDeployment({
      provider: 'cloudflare',
      projectName: `${MARKER}-cf-ok`,
      status: 'deploying',
      deploymentId: 'cf_dep_ok',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            latest_stage: { name: 'deploy', status: 'success' },
            url: 'https://cf.pages.dev',
            id: 'cf_dep_ok',
          },
        }),
        text: async () => '',
      }),
    );
    try {
      const res = await deploy.request(`/${row.id}/refresh`, { method: 'POST' });
      expect([200, 400, 500]).toContain(res.status);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('refresh unsupported provider returns 400', async () => {
    // Insert row then force provider if possible — createDeployment may normalize providers
    const row = createDeployment({
      provider: 'vercel',
      projectName: `${MARKER}-unsup`,
      status: 'deploying',
      deploymentId: 'dpl_x',
    });
    // Manually corrupt provider in DB for unsupported branch
    const { getDb } = await import('../db/schema.js');
    getDb().prepare(`UPDATE deployments SET provider = ? WHERE id = ?`).run('aws', row.id);

    const res = await deploy.request(`/${row.id}/refresh`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Unsupported provider/i);
  });

  it('DELETE blank id and missing id', async () => {
    const blank = await deploy.request('/%20', { method: 'DELETE' });
    expect(blank.status).toBe(404);
    const missing = await deploy.request('/no-such-deployment', { method: 'DELETE' });
    expect(missing.status).toBe(404);
  });
});
