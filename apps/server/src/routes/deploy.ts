/**
 * Deploy routes
 * POST /api/deploy              — Deploy content to Vercel or Cloudflare (records history)
 * GET  /api/deploy              — List deployment history (?workflowId= optional)
 * GET  /api/deploy/:id          — Single deployment
 * DELETE /api/deploy/:id        — Delete history entry
 */

import { Hono } from 'hono';
import { getSecretSetting } from '../db/settings.js';
import {
  deployToVercel,
  deployToCloudflare,
  getVercelDeploymentStatus,
  getCloudflareDeploymentStatus,
  isValidDeployProjectName,
} from '../lib/deploy.js';
import {
  createDeployment,
  deleteDeployment,
  getDeployment,
  listDeployments,
  updateDeployment,
} from '../db/deployments.js';

const deploy = new Hono();

/**
 * Preflight: check whether deploy credentials/config look ready for a provider.
 * Does not create a deployment.
 */
deploy.post('/preflight', async (c) => {
  const body = await c.req.json<{ provider?: 'vercel' | 'cloudflare'; projectName?: string }>().catch(() => ({} as { provider?: string }));
  const provider = body.provider ?? 'vercel';
  if (provider !== 'vercel' && provider !== 'cloudflare') {
    return c.json({ ok: false, error: 'provider must be vercel or cloudflare' }, 400);
  }

  const checks: Array<{ key: string; ok: boolean; message: string }> = [];

  if (provider === 'vercel') {
    const token = getSecretSetting('VERCEL_API_TOKEN');
    checks.push({
      key: 'VERCEL_API_TOKEN',
      ok: Boolean(token),
      message: token ? 'Vercel API token configured' : 'Missing Vercel API token in Settings',
    });
  } else {
    const token = getSecretSetting('CLOUDFLARE_API_TOKEN');
    const accountId = getSecretSetting('CLOUDFLARE_ACCOUNT_ID');
    checks.push({
      key: 'CLOUDFLARE_API_TOKEN',
      ok: Boolean(token),
      message: token ? 'Cloudflare API token configured' : 'Missing Cloudflare API token in Settings',
    });
    checks.push({
      key: 'CLOUDFLARE_ACCOUNT_ID',
      ok: Boolean(accountId),
      message: accountId ? 'Cloudflare Account ID configured' : 'Missing Cloudflare Account ID in Settings',
    });
  }

  const rawProject = (body as { projectName?: string }).projectName;
  const projectName = (typeof rawProject === 'string' ? rawProject.trim() : '') || 'neos-deploy';
  const projectOk = isValidDeployProjectName(projectName);
  checks.push({
    key: 'projectName',
    ok: projectOk,
    message: projectOk
      ? `Project name: ${projectName}`
      : 'Project name must start with a letter or digit and use only letters, digits, hyphens, or underscores (max 63).',
  });

  const ready = checks.every((ch) => ch.ok);
  return c.json({
    ok: true,
    data: {
      provider,
      ready,
      checks,
    },
  });
});

deploy.get('/', (c) => {
  const workflowId = (c.req.query('workflowId') ?? '').trim() || undefined;
  const limitRaw = c.req.query('limit');
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 500) : 100;
  const rows = listDeployments({ workflowId, limit });
  return c.json({ ok: true, data: rows });
});

deploy.get('/:id', (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const row = getDeployment(id);
  if (!row) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true, data: row });
});

/**
 * Poll remote provider for deployment status and update local history row.
 */
deploy.post('/:id/refresh', async (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const row = getDeployment(id);
  if (!row) return c.json({ ok: false, error: 'Not found' }, 404);
  if (!row.deploymentId) {
    return c.json({ ok: false, error: 'No remote deployment id to poll' }, 400);
  }

  try {
    if (row.provider === 'vercel') {
      const apiToken = getSecretSetting('VERCEL_API_TOKEN');
      if (!apiToken) return c.json({ ok: false, error: 'Vercel API token not configured' }, 400);
      const remote = await getVercelDeploymentStatus(row.deploymentId, apiToken);
      const updated = updateDeployment(row.id, {
        status: remote.status,
        url: remote.url ?? row.url,
        statusMessage: remote.statusMessage,
      });
      return c.json({ ok: true, data: updated });
    }

    if (row.provider === 'cloudflare') {
      const apiToken = getSecretSetting('CLOUDFLARE_API_TOKEN');
      const accountId = getSecretSetting('CLOUDFLARE_ACCOUNT_ID');
      if (!apiToken || !accountId) {
        return c.json({ ok: false, error: 'Cloudflare credentials not configured' }, 400);
      }
      const projectName = row.projectName ?? 'neos-deploy';
      const remote = await getCloudflareDeploymentStatus({
        accountId,
        projectName,
        deploymentId: row.deploymentId,
        apiToken,
      });
      const updated = updateDeployment(row.id, {
        status: remote.status,
        url: remote.url ?? row.url,
        statusMessage: remote.statusMessage,
      });
      return c.json({ ok: true, data: updated });
    }

    return c.json({ ok: false, error: `Unsupported provider: ${row.provider}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Status refresh failed';
    return c.json({ ok: false, error: msg }, 500);
  }
});

deploy.delete('/:id', (c) => {
  const id = c.req.param('id').trim();
  if (!id) return c.json({ ok: false, error: 'Not found' }, 404);
  const ok = deleteDeployment(id);
  if (!ok) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({ ok: true });
});

deploy.post('/', async (c) => {
  const body = await c.req.json<{
    provider: 'vercel' | 'cloudflare';
    content: string;
    projectName?: string;
    workflowId?: string;
    runId?: string;
  }>();

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!body.provider || !content) {
    return c.json({ ok: false, error: 'provider and content are required' }, 400);
  }
  if (!['vercel', 'cloudflare'].includes(body.provider)) {
    return c.json({ ok: false, error: 'provider must be vercel or cloudflare' }, 400);
  }
  if (content.length > 5_000_000) {
    return c.json({ ok: false, error: 'content too large' }, 400);
  }

  const projectName =
    (typeof body.projectName === 'string' ? body.projectName.trim() : '') || 'neos-deploy';
  if (!isValidDeployProjectName(projectName)) {
    return c.json({
      ok: false,
      error:
        'Invalid project name: must start with a letter or digit and use only letters, digits, hyphens, or underscores (max 63).',
    }, 400);
  }

  const record = createDeployment({
    workflowId: body.workflowId,
    runId: body.runId,
    provider: body.provider,
    projectName,
    status: 'deploying',
  });

  try {
    if (body.provider === 'vercel') {
      const apiToken = getSecretSetting('VERCEL_API_TOKEN');
      if (!apiToken) {
        updateDeployment(record.id, { status: 'failed', statusMessage: 'Vercel API token not configured' });
        return c.json({ ok: false, error: 'Vercel API token not configured' }, 400);
      }
      const result = await deployToVercel({ projectName, content, apiToken });
      const updated = updateDeployment(record.id, {
        status: 'success',
        url: result.url,
        deploymentId: result.deploymentId,
      });
      return c.json({ ok: true, data: { ...result, recordId: updated?.id ?? record.id } });
    } else {
      const apiToken = getSecretSetting('CLOUDFLARE_API_TOKEN');
      const accountId = getSecretSetting('CLOUDFLARE_ACCOUNT_ID');
      if (!apiToken || !accountId) {
        updateDeployment(record.id, {
          status: 'failed',
          statusMessage: 'Cloudflare API token and Account ID not configured',
        });
        return c.json({ ok: false, error: 'Cloudflare API token and Account ID not configured' }, 400);
      }
      const result = await deployToCloudflare({
        projectName,
        content,
        accountId,
        apiToken,
      });
      const updated = updateDeployment(record.id, {
        status: 'success',
        url: result.url,
        deploymentId: result.deploymentId,
      });
      return c.json({ ok: true, data: { ...result, recordId: updated?.id ?? record.id } });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Deploy failed';
    updateDeployment(record.id, { status: 'failed', statusMessage: msg });
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default deploy;
