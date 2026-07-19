import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeployNode } from './deploy.js';
import type { NodeContext } from '../types.js';

function ctx(partial: Partial<NodeContext> = {}): NodeContext {
  return {
    workflowId: 'wf-1',
    runId: 'run-1',
    nodeId: 'deploy',
    inputs: {},
    settings: { SERVER_URL: 'http://localhost:9', SERVER_TOKEN: 't' },
    config: { provider: 'vercel', projectName: 'demo' },
    ...partial,
  };
}

describe('DeployNode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fails without content', async () => {
    const result = await DeployNode.execute(ctx());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No content/);
  });

  it('posts deploy payload with workflow metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { url: 'https://demo.vercel.app', deploymentId: 'd1' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await DeployNode.execute(
      ctx({ inputs: { content: '<html>hi</html>' } }),
    );
    expect(result.ok).toBe(true);
    expect(String(result.output)).toContain('https://demo.vercel.app');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      provider: 'vercel',
      content: '<html>hi</html>',
      projectName: 'demo',
      workflowId: 'wf-1',
      runId: 'run-1',
    });
  });

  it('propagates deploy API failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: async () => ({ ok: false, error: 'token missing' }),
    }));
    const result = await DeployNode.execute(ctx({ inputs: { content: 'x' } }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('token missing');
  });

  it('uses config.content and inputs.projectName', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { url: 'https://cf.pages.dev' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await DeployNode.execute(
      ctx({
        config: { provider: 'cloudflare', content: '<p>cfg</p>' },
        inputs: { projectName: 'from-input' },
      }),
    );
    expect(result.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.provider).toBe('cloudflare');
    expect(body.content).toBe('<p>cfg</p>');
    expect(body.projectName).toBe('from-input');
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer t');
  });

  it('trims projectName and falls back invalid provider to vercel', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { url: 'https://x.app' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await DeployNode.execute(
      ctx({
        config: { provider: 'netlify', projectName: '  my-app  ', content: '<p/>' },
        inputs: {},
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.provider).toBe('vercel');
    expect(body.projectName).toBe('my-app');
  });

  it('uses neos-deploy when projectName is blank after trim', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { url: 'https://x.app' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await DeployNode.execute(
      ctx({
        config: { provider: 'vercel', projectName: '   ', content: '<p/>' },
        inputs: {},
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.projectName).toBe('neos-deploy');
  });

  it('keeps cloudflare provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true, data: { url: 'https://cf.pages.dev' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await DeployNode.execute(
      ctx({
        config: { provider: 'cloudflare', projectName: 'site', content: '<p/>' },
        inputs: {},
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.provider).toBe('cloudflare');
  });
});
