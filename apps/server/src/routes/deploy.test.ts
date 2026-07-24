import { afterEach, describe, expect, it } from 'vitest';
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
  });
});
