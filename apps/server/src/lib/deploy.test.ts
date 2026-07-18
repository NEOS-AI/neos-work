import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deployToVercel,
  getCloudflareDeploymentStatus,
  getVercelDeploymentStatus,
} from './deploy.js';

describe('deploy helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('getVercelDeploymentStatus', () => {
    it('maps READY → success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ readyState: 'READY', url: 'demo.vercel.app' }),
      }));
      const r = await getVercelDeploymentStatus('dpl_1', 'tok');
      expect(r.status).toBe('success');
      expect(r.url).toBe('https://demo.vercel.app');
      expect(r.readyState).toBe('READY');
    });

    it('maps ERROR → failed', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ readyState: 'ERROR' }),
      }));
      const r = await getVercelDeploymentStatus('dpl_2', 'tok');
      expect(r.status).toBe('failed');
    });

    it('maps QUEUED → pending', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ readyState: 'QUEUED' }),
      }));
      const r = await getVercelDeploymentStatus('dpl_3', 'tok');
      expect(r.status).toBe('pending');
    });

    it('maps BUILDING → deploying', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ readyState: 'BUILDING' }),
      }));
      const r = await getVercelDeploymentStatus('dpl_4', 'tok');
      expect(r.status).toBe('deploying');
    });

    it('throws on HTTP error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { message: 'not found' } }),
      }));
      await expect(getVercelDeploymentStatus('x', 'tok')).rejects.toThrow(/not found|404/);
    });
  });

  describe('getCloudflareDeploymentStatus', () => {
    it('maps success stage', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: { url: 'https://p.pages.dev', latest_stage: { status: 'success' } },
        }),
      }));
      const r = await getCloudflareDeploymentStatus({
        accountId: 'acc',
        projectName: 'p',
        deploymentId: 'dep',
        apiToken: 'tok',
      });
      expect(r.status).toBe('success');
      expect(r.url).toBe('https://p.pages.dev');
    });

    it('maps failure stage', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { latest_stage: { status: 'failure' } } }),
      }));
      const r = await getCloudflareDeploymentStatus({
        accountId: 'acc',
        projectName: 'p',
        deploymentId: 'dep',
        apiToken: 'tok',
      });
      expect(r.status).toBe('failed');
    });

    it('throws on API error payload', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ errors: [{ message: 'forbidden' }] }),
      }));
      await expect(
        getCloudflareDeploymentStatus({
          accountId: 'acc',
          projectName: 'p',
          deploymentId: 'dep',
          apiToken: 'tok',
        }),
      ).rejects.toThrow(/forbidden/);
    });
  });

  describe('deployToVercel', () => {
    it('returns url and deployment id on success', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ url: 'my-app.vercel.app', id: 'dpl_abc' }),
      }));
      const r = await deployToVercel({
        projectName: 'my-app',
        content: '<html>hi</html>',
        apiToken: 'tok',
      });
      expect(r.url).toBe('https://my-app.vercel.app');
      expect(r.deploymentId).toBe('dpl_abc');
    });

    it('throws when API fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'bad request' } }),
      }));
      await expect(
        deployToVercel({ projectName: 'x', content: 'y', apiToken: 't' }),
      ).rejects.toThrow(/bad request/);
    });
  });
});
