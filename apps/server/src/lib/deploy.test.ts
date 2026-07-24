import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deployToCloudflare,
  deployToVercel,
  getCloudflareDeploymentStatus,
  getVercelDeploymentStatus,
  isValidDeployProjectName,
} from './deploy.js';

describe('isValidDeployProjectName', () => {
  it('accepts alnum start and alnum/hyphen/underscore body (max 63)', () => {
    expect(isValidDeployProjectName('neos-deploy')).toBe(true);
    expect(isValidDeployProjectName('My_App1')).toBe(true);
    expect(isValidDeployProjectName('a')).toBe(true);
    expect(isValidDeployProjectName('A' + 'b'.repeat(62))).toBe(true);
  });

  it('rejects empty, leading punctuation, spaces, dots, over-length', () => {
    expect(isValidDeployProjectName('')).toBe(false);
    expect(isValidDeployProjectName('-bad')).toBe(false);
    expect(isValidDeployProjectName('_bad')).toBe(false);
    expect(isValidDeployProjectName('has space')).toBe(false);
    expect(isValidDeployProjectName('dot.name')).toBe(false);
    expect(isValidDeployProjectName('A' + 'b'.repeat(63))).toBe(false);
  });
});

describe('deploy helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('surfaces network failures for deployToVercel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(
      deployToVercel({ projectName: 'x', content: '<p/>', apiToken: 'tok' }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it('rejects blank projectName/content/apiToken for deployToVercel', async () => {
    await expect(
      deployToVercel({ projectName: '  ', content: '<p/>', apiToken: 'tok' }),
    ).rejects.toThrow(/projectName/i);
    await expect(
      deployToVercel({ projectName: 'x', content: '   ', apiToken: 'tok' }),
    ).rejects.toThrow(/content/i);
    await expect(
      deployToVercel({ projectName: 'x', content: '<p/>', apiToken: '  ' }),
    ).rejects.toThrow(/apiToken/i);
  });

  it('rejects blank ids/tokens for deployment status helpers', async () => {
    await expect(getVercelDeploymentStatus('  ', 'tok')).rejects.toThrow(/deploymentId/i);
    await expect(getVercelDeploymentStatus('dpl_1', '  ')).rejects.toThrow(/apiToken/i);
    await expect(
      getCloudflareDeploymentStatus({
        accountId: '  ',
        projectName: 'p',
        deploymentId: 'd',
        apiToken: 't',
      }),
    ).rejects.toThrow(/accountId/i);
    await expect(
      getCloudflareDeploymentStatus({
        accountId: 'a',
        projectName: '  ',
        deploymentId: 'd',
        apiToken: 't',
      }),
    ).rejects.toThrow(/projectName/i);
  });

  it('trims and encodes vercel deployment id in status URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ readyState: 'READY', url: 'demo.vercel.app' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await getVercelDeploymentStatus('  dpl_1  ', '  tok  ');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/deployments/dpl_1');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('surfaces network failures for getVercelDeploymentStatus', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(getVercelDeploymentStatus('dpl_1', 'tok')).rejects.toThrow(/offline/);
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

    it('maps CANCELED → failed and INITIALIZING → pending via alias', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ readyState: 'CANCELED' }),
      }));
      expect((await getVercelDeploymentStatus('dpl_c', 'tok')).status).toBe('failed');

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ readyState: 'INITIALIZING', alias: ['via-alias.vercel.app'] }),
      }));
      const pending = await getVercelDeploymentStatus('dpl_i', 'tok');
      expect(pending.status).toBe('pending');
      expect(pending.url).toBe('https://via-alias.vercel.app');
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

    it('maps canceled → failed and idle/active → pending', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { latest_stage: { status: 'canceled' } } }),
      }));
      expect(
        (
          await getCloudflareDeploymentStatus({
            accountId: 'acc',
            projectName: 'p',
            deploymentId: 'dep',
            apiToken: 'tok',
          })
        ).status,
      ).toBe('failed');

      for (const stage of ['idle', 'active'] as const) {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ result: { latest_stage: { status: stage } } }),
        }));
        expect(
          (
            await getCloudflareDeploymentStatus({
              accountId: 'acc',
              projectName: 'p',
              deploymentId: 'dep',
              apiToken: 'tok',
            })
          ).status,
        ).toBe('pending');
      }
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

    it('surfaces network failures and blank deploymentId/apiToken', async () => {
      await expect(
        getCloudflareDeploymentStatus({
          accountId: 'acc',
          projectName: 'p',
          deploymentId: '  ',
          apiToken: 'tok',
        }),
      ).rejects.toThrow(/deploymentId/i);
      await expect(
        getCloudflareDeploymentStatus({
          accountId: 'acc',
          projectName: 'p',
          deploymentId: 'dep',
          apiToken: '  ',
        }),
      ).rejects.toThrow(/apiToken/i);

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('CF status offline')));
      await expect(
        getCloudflareDeploymentStatus({
          accountId: 'acc',
          projectName: 'p',
          deploymentId: 'dep',
          apiToken: 'tok',
        }),
      ).rejects.toThrow(/CF status offline/);
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

    it('throws when success payload omits url', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'dpl_no_url' }),
      }));
      await expect(
        deployToVercel({ projectName: 'x', content: 'y', apiToken: 't' }),
      ).rejects.toThrow(/No deployment URL/);
    });
  });

  describe('deployToCloudflare', () => {
    it('rejects blank required fields after trim', async () => {
      await expect(
        deployToCloudflare({
          projectName: '  ',
          content: '<p/>',
          accountId: 'acc',
          apiToken: 'tok',
        }),
      ).rejects.toThrow(/projectName/i);
      await expect(
        deployToCloudflare({
          projectName: 'p',
          content: '   ',
          accountId: 'acc',
          apiToken: 'tok',
        }),
      ).rejects.toThrow(/content/i);
      await expect(
        deployToCloudflare({
          projectName: 'p',
          content: '<p/>',
          accountId: '  ',
          apiToken: 'tok',
        }),
      ).rejects.toThrow(/accountId/i);
      await expect(
        deployToCloudflare({
          projectName: 'p',
          content: '<p/>',
          accountId: 'acc',
          apiToken: '  ',
        }),
      ).rejects.toThrow(/apiToken/i);
    });

    it('creates deployment and returns url + deployment id', async () => {
      const fetchMock = vi.fn()
        // ensure project exists (POST projects) — may fail; ignored
        .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({}) })
        // create deployment
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            result: { url: 'https://my-pages.pages.dev', id: 'cf-dep-1' },
          }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const r = await deployToCloudflare({
        projectName: '  my-pages  ',
        content: '<html>cf</html>',
        accountId: '  acc  ',
        apiToken: '  tok  ',
      });
      expect(r.url).toBe('https://my-pages.pages.dev');
      expect(r.deploymentId).toBe('cf-dep-1');
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const deployCall = fetchMock.mock.calls[1]!;
      expect(String(deployCall[0])).toContain('/pages/projects/my-pages/deployments');
      expect(deployCall[1]?.headers).toMatchObject({ Authorization: 'Bearer tok' });
      expect(deployCall[1]?.body).toBeInstanceOf(FormData);
    });

    it('falls back to pages.dev URL when result.url is missing', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ result: { id: 'cf-dep-2' } }),
          }),
      );
      const r = await deployToCloudflare({
        projectName: 'fallback-app',
        content: '<p>x</p>',
        accountId: 'acc',
        apiToken: 'tok',
      });
      expect(r.url).toBe('https://fallback-app.pages.dev');
      expect(r.deploymentId).toBe('cf-dep-2');
    });

    it('throws on deploy API error payload', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
          .mockResolvedValueOnce({
            ok: false,
            status: 400,
            json: async () => ({ errors: [{ message: 'invalid pages project' }] }),
          }),
      );
      await expect(
        deployToCloudflare({
          projectName: 'p',
          content: '<p/>',
          accountId: 'acc',
          apiToken: 'tok',
        }),
      ).rejects.toThrow(/invalid pages project/);
    });

    it('surfaces network failure on deploy POST (create-project network ignored)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockRejectedValueOnce(new Error('create project offline'))
          .mockRejectedValueOnce(new Error('deploy offline')),
      );
      await expect(
        deployToCloudflare({
          projectName: 'p',
          content: '<p/>',
          accountId: 'acc',
          apiToken: 'tok',
        }),
      ).rejects.toThrow(/deploy offline/);
    });

    it('falls back to status code when error body is empty', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn()
          .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
          .mockResolvedValueOnce({
            ok: false,
            status: 503,
            json: async () => {
              throw new Error('no body');
            },
          }),
      );
      await expect(
        deployToCloudflare({
          projectName: 'p',
          content: '<p/>',
          accountId: 'acc',
          apiToken: 'tok',
        }),
      ).rejects.toThrow(/503/);
    });
  });
});
