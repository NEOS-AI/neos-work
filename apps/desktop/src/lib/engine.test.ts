import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineClient } from './engine.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
  });
}

describe('EngineClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes base url and auth header after setAuthToken', async () => {
    const client = new EngineClient('http://engine.test');
    expect(client.url).toBe('http://engine.test');
    client.setAuthToken('secret');

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listSessions();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://engine.test/api/session',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('health and checkConnection', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok', version: '0.3.29' }));
    await expect(client.health()).resolves.toMatchObject({ status: 'ok', version: '0.3.29' });
    expect(fetchMock).toHaveBeenCalledWith('http://engine.test/api/health');

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'ok' }));
    await expect(client.checkConnection()).resolves.toBe(true);

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'down' }));
    await expect(client.checkConnection()).resolves.toBe(false);

    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(client.checkConnection()).resolves.toBe(false);
  });

  it('listSessions passes workspaceId query', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listSessions('ws-1');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://engine.test/api/session?workspaceId=ws-1');
  });

  it('createSession posts JSON body', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 's1' } }));
    await client.createSession({ workspaceId: 'ws', title: 'T', provider: 'openai', model: 'gpt-4o' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      workspaceId: 'ws',
      title: 'T',
      provider: 'openai',
      model: 'gpt-4o',
    });
  });

  it('deleteSession uses DELETE', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client.deleteSession('s1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://engine.test/api/session/s1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('workflow CRUD endpoints', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: {} }));

    await client.listWorkflows();
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('http://engine.test/api/workflow');

    await client.getWorkflow('w1');
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('http://engine.test/api/workflow/w1');

    await client.createWorkflow({ name: 'N', domain: 'general' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.updateWorkflow('w1', { name: 'N2' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');

    await client.deleteWorkflow('w1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.duplicateWorkflow('w1');
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('http://engine.test/api/workflow/w1/duplicate');
  });

  it('routine endpoints', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: [] }));

    await client.listRoutines();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/routines');

    await client.createRoutine({
      name: 'R',
      workflowId: 'w1',
      schedule: '0 9 * * *',
      timezone: 'UTC',
      enabled: true,
    });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.runRoutineNow('r1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/routines/r1/run');

    await client.listRoutineRuns('r1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/routines/r1/runs');

    await client.crystallizeRoutineRun('r1', 'run1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/crystallize/);
  });

  it('media config and list', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { openaiConfigured: true, surfaces: ['image', 'audio'] },
      }),
    );
    const cfg = await client.getMediaConfig();
    expect(cfg.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/media/config');

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listMediaFiles(50);
    expect(String(fetchMock.mock.calls[1]![0])).toContain('limit=50');
  });

  it('deploy preflight and list deployments', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { ready: true } }));
    await client.deployPreflight('vercel', 'proj');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/deploy/preflight');
    expect(init.method).toBe('POST');

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listDeployments('wf-1', 10);
    expect(String(fetchMock.mock.calls[1]![0])).toMatch(/workflowId=wf-1/);
  });

  it('revisions API', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: [] }));
    await client.listRevisions('w1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/revisions/);
    await client.getRevision('w1', 'rev1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('rev1');
    await client.updateRevisionLabel('w1', 'rev1', 'label');
    expect(fetchMock.mock.calls.at(-1)![1].method).toMatch(/PATCH|PUT|POST/);
    await client.deleteRevision('w1', 'rev1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');
  });

  it('exportWorkflow triggers download when ok', async () => {
    const client = new EngineClient('http://engine.test');
    const blob = new Blob(['{}'], { type: 'application/json' });
    fetchMock.mockResolvedValueOnce(
      new Response(blob, { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const click = vi.fn();
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click } as unknown as HTMLAnchorElement;
      }
      return document.createElement(tag);
    });
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    await client.exportWorkflow('w1', 'My Workflow!');
    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();

    createElement.mockRestore();
  });

  it('exportWorkflow no-ops when response not ok', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    await client.exportWorkflow('w1', 'x');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('importWorkflowZip strips Content-Type for FormData', async () => {
    const client = new EngineClient('http://engine.test');
    client.setAuthToken('t');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'w' } }));
    const file = new File(['zip'], 'a.zip', { type: 'application/zip' });
    await client.importWorkflowZip(file);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.headers.Authorization).toBe('Bearer t');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('preflightWorkflow posts to preflight endpoint', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { ok: true, issues: [] } }));
    await client.preflightWorkflow('w1');
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/preflight/);
  });

  it('cli agents and design systems list', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: [] }));
    await client.listCliAgents();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/cli-agents|cli/);
    await client.listDesignSystems();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/design-systems/);
    await client.listPlugins();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/plugins/);
  });
});
