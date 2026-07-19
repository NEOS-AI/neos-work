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
    // jsdom may lack blob URL helpers — install test doubles
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    const urlProto = URL as unknown as {
      createObjectURL?: typeof createObjectURL;
      revokeObjectURL?: typeof revokeObjectURL;
    };
    const prevCreate = urlProto.createObjectURL;
    const prevRevoke = urlProto.revokeObjectURL;
    urlProto.createObjectURL = createObjectURL;
    urlProto.revokeObjectURL = revokeObjectURL;

    await client.exportWorkflow('w1', 'My Workflow!');
    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();

    createElement.mockRestore();
    urlProto.createObjectURL = prevCreate;
    urlProto.revokeObjectURL = prevRevoke;
  });

  it('exportWorkflow no-ops when response not ok', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const createObjectURL = vi.fn();
    const urlProto = URL as unknown as { createObjectURL?: typeof createObjectURL };
    const prevCreate = urlProto.createObjectURL;
    urlProto.createObjectURL = createObjectURL;
    await client.exportWorkflow('w1', 'x');
    expect(createObjectURL).not.toHaveBeenCalled();
    urlProto.createObjectURL = prevCreate;
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

  it('settings and models endpoints', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: {} }));

    await client.getSettings();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/settings');

    await client.getSetting('OPENAI_API_KEY');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain(encodeURIComponent('OPENAI_API_KEY'));

    await client.saveSetting('OPENAI_API_KEY', 'sk-test');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)).toEqual({ value: 'sk-test' });

    await client.verifyApiKey('openai', 'sk-x');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.listModels();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/models');
  });

  it('skills and mcp server endpoints', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: [] }));

    await client.listSkills();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/skills');

    await client.scanSkills();
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/scan/);

    await client.toggleSkill('sk1', false);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/skills/sk1/toggle');

    await client.deleteSkill('sk1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.upgradeSkillToPlugin('sk1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/upgrade-from-skill/);

    await client.listMcpServers();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/mcp/);

    await client.createMcpServer({
      name: 'm',
      transport: 'stdio',
      command: 'npx',
    });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.toggleMcpServer('m1', true);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.deleteMcpServer('m1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.getMcpOAuthStatus('m1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/oauth|status/i);

    await client.revokeMcpOAuth('m1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toMatch(/DELETE|POST/);
  });

  it('memory, blocks, harnesses, templates, workspaces', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: [] }));

    await client.listMemories();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/memory/);

    await client.createMemory({ name: 'n', type: 'user', content: 'c' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.deleteMemory('mem1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.listBlocks();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/block/);

    await client.listHarnesses();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/harness/);

    await client.getTemplates();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/template/);

    await client.listWorkspaces();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/workspace/);

    await client.createWorkspace({ name: 'w', type: 'local' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.deleteWorkspace('ws1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');
  });

  it('artifacts, media delete, deployments, revisions restore', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: {} }));

    await client.listArtifacts({ workflowId: 'w1' });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/artifact/);

    await client.getArtifact('a1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('a1');

    await client.deleteArtifact('a1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.refreshArtifact('a1', 'reload');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)).toEqual({ mode: 'reload' });

    await client.deleteMediaFile('img.png');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.getDeployment('d1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/deploy/d1');

    await client.deleteDeployment('d1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.refreshDeployment('d1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.restoreRevision('w1', 'rev1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/restore/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
  });

  it('workflow runs list/get/delete/clear', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: [] }));

    await client.listWorkflowRuns('w1', 10, 5);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('limit=10');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('offset=5');

    await client.getWorkflowRun('w1', 'run1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('run1');

    await client.deleteWorkflowRun('w1', 'run1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.clearWorkflowRuns('w1', 'failed');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('status=failed');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');
  });

  it('webhook secret, rate limit, and regenerate endpoints', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () =>
      jsonResponse({ ok: true, data: { secret: 'abc', limit: 60, remaining: 59, resetAt: 0, windowMs: 60_000 } }),
    );

    await client.getWebhookSecret('w1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(
      'http://engine.test/api/webhook/w1/secret',
    );

    await client.getWebhookRateLimit('w1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(
      'http://engine.test/api/webhook/w1/rate-limit',
    );

    await client.regenerateWebhookSecret('w1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(
      'http://engine.test/api/webhook/w1/regenerate',
    );
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
  });

  it('testWebhookFire signs body and posts without bearer', async () => {
    const client = new EngineClient('http://engine.test');
    client.setAuthToken('should-not-appear');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { secret: 'sekrit' } }))
      .mockResolvedValueOnce(
        new Response(null, { status: 202 }),
      );

    const result = await client.testWebhookFire('wf-1', { hello: 1 });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);

    const fireCall = fetchMock.mock.calls[1]!;
    expect(String(fireCall[0])).toBe('http://engine.test/api/webhook/wf-1');
    expect(fireCall[1].method).toBe('POST');
    expect(fireCall[1].headers.Authorization).toBeUndefined();
    expect(fireCall[1].headers['X-Neos-Signature']).toMatch(/^sha256=/);
    expect(fireCall[1].body).toBe(JSON.stringify({ hello: 1 }));
  });

  it('testWebhookFire fails when secret missing', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'nope' }));
    const result = await client.testWebhookFire('wf-1');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/secret/i);
  });

  it('runWorkflow parses SSE data lines and abort cancels', async () => {
    const client = new EngineClient('http://engine.test');
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"run.started","runId":"r1"}\n\ndata: {"type":"run.completed","runId":"r1","duration":1}\n\n',
          ),
        );
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const events: unknown[] = [];
    const stop = client.runWorkflow('w1', (e) => events.push(e), { x: 1 });
    await vi.waitFor(() => {
      expect(events.length).toBeGreaterThanOrEqual(2);
    });
    expect(events[0]).toMatchObject({ type: 'run.started', runId: 'r1' });
    expect(events[1]).toMatchObject({ type: 'run.completed' });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ inputs: { x: 1 } });
    expect(typeof stop).toBe('function');
    stop();
  });

  it('importWorkflow posts JSON archive', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'w' } }));
    await client.importWorkflow({
      version: '1',
      workflow: { name: 'N', domain: 'general', nodes: [], edges: [] },
    });
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/import/);
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
  });

  it('design system content and routine get/delete', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: { content: '# D' } }));

    await client.createDesignSystem('brand', 'desc');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.getDesignSystemContent('ds1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/content/);

    await client.saveDesignSystemContent('ds1', '# x');
    expect(fetchMock.mock.calls.at(-1)![1].method).toMatch(/PUT|POST/);

    await client.deleteDesignSystem('ds1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.getRoutine('r1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/routines/r1');

    await client.deleteRoutine('r1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.getPlugin('p1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/plugins/p1');
  });

  it('session messages, cancel, and tool confirm', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: [] }));

    await client.listMessages('s1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(
      'http://engine.test/api/session/s1/messages',
    );

    await client.cancelSession('s1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(
      'http://engine.test/api/session/s1/cancel',
    );
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.confirmTool('s1', 'tu-1', true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/tool-confirm/tu-1');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)).toEqual({ approved: true });
  });

  it('chat SSE yields chunks and errors on non-ok response', async () => {
    const client = new EngineClient('http://engine.test');
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"token","content":"hi"}\n\ndata: not-json\n\n'),
        );
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const chunks: unknown[] = [];
    for await (const c of client.chat('s1', 'hello')) {
      chunks.push(c);
    }
    expect(chunks).toEqual([{ type: 'token', content: 'hi' }]);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500, statusText: 'Err' }));
    const errChunks: unknown[] = [];
    for await (const c of client.chat('s1', 'x')) {
      errChunks.push(c);
    }
    expect(errChunks[0]).toMatchObject({ type: 'error' });
  });

  it('runAgent SSE maps event name into chunk type', async () => {
    const client = new EngineClient('http://engine.test');
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: tool_call\ndata: {"name":"shell"}\n\n'),
        );
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const chunks: unknown[] = [];
    for await (const c of client.runAgent('s1', 'run')) {
      chunks.push(c);
    }
    expect(chunks[0]).toMatchObject({ type: 'tool_call', name: 'shell' });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503, statusText: 'Down' }));
    const err: unknown[] = [];
    for await (const c of client.runAgent('s1', 'x')) {
      err.push(c);
    }
    expect(err[0]).toMatchObject({ type: 'error' });
  });

  it('harness and block CRUD with domain query', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: {} }));

    await client.createHarness({
      id: 'h1',
      name: 'H',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'p',
      allowedTools: [],
    });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/harness/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.updateHarness('h1', { name: 'H2' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');

    await client.deleteHarness('h1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.listBlocks('coding');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('domain=coding');

    await client.createBlock({
      id: 'b1',
      name: 'B',
      domain: 'general',
      category: 'c',
      description: 'd',
      implementationType: 'prompt',
      paramDefs: [],
      inputDescription: 'i',
      outputDescription: 'o',
    });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.updateBlock('b1', { name: 'B2' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');

    await client.deleteBlock('b1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.getTemplates('finance');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('domain=finance');
  });

  it('memory update/toggle, routine update, media helpers', async () => {
    const client = new EngineClient('http://engine.test');
    client.setAuthToken('tok');
    fetchMock.mockImplementation(async () =>
      jsonResponse({ ok: true, data: {} }, { status: 200 }),
    );

    await client.updateMemory('m1', { content: 'x' });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/memory/m1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');

    await client.toggleMemory('m1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/toggle/);

    await client.updateRoutine('r1', { enabled: false });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');

    expect(client.mediaFileUrl('a b.png')).toBe(
      'http://engine.test/api/media/file/a%20b.png',
    );

    const blob = new Blob(['img-bytes']);
    fetchMock.mockResolvedValueOnce(new Response(blob, { status: 200 }));
    const got = await client.fetchMediaBlob('x.png');
    // jsdom may use a different Blob realm than the global under test
    expect(got.size).toBeGreaterThan(0);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/media/file/x.png');
    expect(fetchMock.mock.calls.at(-1)![1].headers.Authorization).toBe('Bearer tok');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(client.fetchMediaBlob('missing.png')).rejects.toThrow(/Failed to load media/);
  });

  it('MCP OAuth start/refresh and workspace update', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () =>
      jsonResponse({ ok: true, data: { authUrl: 'https://auth', state: 'st' } }),
    );

    await client.startMcpOAuth({
      serverId: 'm1',
      authorizationEndpoint: 'https://a',
      tokenEndpoint: 'https://t',
      clientId: 'cid',
      redirectUri: 'http://localhost/cb',
    });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/oauth\/start/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.refreshMcpOAuth('m1', { tokenEndpoint: 'https://t', clientId: 'cid' });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/refresh/);

    await client.updateWorkspace('ws1', { name: 'Renamed' });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/workspace/ws1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toMatch(/PUT|PATCH/);
  });

  it('artifact update, export zip, import claude design, plugin run/resume', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: {} }));

    await client.updateArtifact('a1', { name: 'T' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toMatch(/PUT|PATCH/);

    await client.resumePlugin('p1', 'run1', 'stage1', { ok: true });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/resume/);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)).toEqual({
      stageId: 'stage1',
      response: { ok: true },
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('data: {"type":"pipeline.started","runId":"run-9"}\n\n'),
        );
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const events: unknown[] = [];
    const { stop, runIdPromise } = client.runPlugin('p1', { q: 1 }, (e) => events.push(e));
    await expect(runIdPromise).resolves.toBe('run-9');
    expect(events[0]).toMatchObject({ type: 'pipeline.started', runId: 'run-9' });
    stop();

    // export zip download
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['zip']), { status: 200 }),
    );
    const click = vi.fn();
    const createElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click } as unknown as HTMLAnchorElement;
      }
      return document.createElement(tag);
    });
    const createObjectURL = vi.fn(() => 'blob:zip');
    const revokeObjectURL = vi.fn();
    const urlProto = URL as unknown as {
      createObjectURL?: typeof createObjectURL;
      revokeObjectURL?: typeof revokeObjectURL;
    };
    const prevCreate = urlProto.createObjectURL;
    const prevRevoke = urlProto.revokeObjectURL;
    urlProto.createObjectURL = createObjectURL;
    urlProto.revokeObjectURL = revokeObjectURL;
    await client.exportWorkflowZip('w1', 'out.zip');
    expect(click).toHaveBeenCalled();
    createElement.mockRestore();
    urlProto.createObjectURL = prevCreate;
    urlProto.revokeObjectURL = prevRevoke;

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'w' } }));
    const file = new File(['z'], 'd.zip', { type: 'application/zip' });
    await client.importClaudeDesignZip(file);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/claude|import/i);
    expect(fetchMock.mock.calls.at(-1)![1].body).toBeInstanceOf(FormData);
  });
});
