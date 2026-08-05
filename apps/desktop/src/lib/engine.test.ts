import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EngineClient,
  formatHttpErrorMessage,
  normalizeProjectRelPath,
  parseSseDataPayload,
  parseSseEventName,
  readApiResponse,
  readHealthResponse,
  scrubApiErrorMessage,
} from './engine.js';

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

  it('sanitizes baseUrl: strips trailing slashes and rejects control chars', () => {
    expect(new EngineClient('http://engine.test/').url).toBe('http://engine.test');
    expect(new EngineClient('  http://engine.test///  ').url).toBe('http://engine.test');
    expect(new EngineClient(`http://x${'\0'}.test`).url).toBe('');
    expect(new EngineClient(`http://x${'\n'}.test`).url).toBe('');
    expect(new EngineClient(null as unknown as string).url).toBe('');
    expect(new EngineClient(42 as unknown as string).url).toBe('');
  });

  it('rejects control-char / blank / traversal path ids without calling fetch', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockClear();

    await expect(client.deleteSession(`s${'\n'}1`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid session id',
    });
    await expect(client.listMessages('')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid session id',
    });
    await expect(client.getWorkflow('../etc')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.listWorkflowRuns(`wf${'\0'}x`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.getWorkflowRun('wf-1', `run${'\n'}2`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid run id',
    });
    await expect(client.clearWorkflowRuns('   ')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.getWebhookSecret('a/b')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.preflightWorkflow('x'.repeat(201))).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Valid id is encoded and reaches fetch
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }));
    await client.deleteSession('sess 1');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/session/sess%201');
  });

  it('rejects control-char settings keys, skill upgrade ids, createRoutine workflowId, media filenames', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockClear();

    await expect(client.getSetting(`KEY${'\n'}X`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid setting key',
    });
    await expect(client.saveSetting('', 'v')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid setting key',
    });
    await expect(client.saveSetting('../etc', 'v')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid setting key',
    });
    // Server setting keys: alnum / _ . - only; max 100
    await expect(client.getSetting('has space')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid setting key',
    });
    await expect(client.saveSetting('x'.repeat(101), 'v')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid setting key',
    });
    await expect(client.upgradeSkillToPlugin(`sk${'\0'}1`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid skill id',
    });
    await expect(
      client.createRoutine({
        name: 'R',
        workflowId: `wf${'\n'}1`,
        schedule: '0 9 * * *',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.createSession({ workspaceId: `ws${'\n'}1` })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workspace id',
    });
    await expect(client.deleteMediaFile(`img${'\n'}.png`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid media filename',
    });
    await expect(client.deleteMediaFile('a b.png')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid media filename',
    });
    await expect(client.deleteMediaFile('../x.png')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid media filename',
    });
    await expect(client.fetchMediaBlob('a b.png')).rejects.toThrow(/Invalid media filename/);
    expect(fetchMock).not.toHaveBeenCalled();

    // Valid paths still reach fetch
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: {} }));
    await client.getSetting('OPENAI_API_KEY');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/settings/OPENAI_API_KEY');
    await client.upgradeSkillToPlugin('sk1');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)).toEqual({ skillId: 'sk1' });
    await client.createRoutine({
      name: 'R',
      workflowId: 'wf-1',
      schedule: '0 9 * * *',
    });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string).workflowId).toBe('wf-1');
    await client.createSession({ workspaceId: 'ws-1', title: 'T' });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string).workspaceId).toBe('ws-1');
  });

  it('rejects control-char / blank / traversal ids across remaining entity APIs without fetch', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockClear();
    const bad = `id${'\n'}x`;
    const blank = '   ';
    const trav = '../etc';

    // Sessions / tools
    await expect(client.listSessions(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workspace id',
    });
    await expect(client.cancelSession(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid session id',
    });
    await expect(client.confirmTool(bad, 'tool-1', true)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid session id',
    });
    await expect(client.confirmTool('sess-1', trav, false)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid tool use id',
    });

    // Workspaces / skills / MCP
    await expect(client.toggleSkill(bad, true)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid skill id',
    });
    await expect(client.deleteSkill(trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid skill id',
    });
    await expect(client.toggleMcpServer(bad, false)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid MCP server id',
    });
    await expect(client.deleteMcpServer(blank)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid MCP server id',
    });
    await expect(client.getMcpOAuthStatus(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid MCP server id',
    });
    await expect(client.revokeMcpOAuth(trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid MCP server id',
    });

    // Design systems / artifacts
    await expect(client.deleteDesignSystem(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid design system id',
    });
    await expect(client.getDesignSystemContent(blank)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid design system id',
    });
    await expect(client.saveDesignSystemContent(trav, 'md')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid design system id',
    });
    await expect(client.listArtifacts({ runId: bad })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid run id',
    });
    await expect(client.listArtifacts({ workflowId: trav })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.listArtifacts({})).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.getArtifact(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid artifact id',
    });
    await expect(client.refreshArtifact(blank)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid artifact id',
    });
    await expect(client.deleteArtifact(trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid artifact id',
    });
    await expect(client.updateArtifact(bad, { name: 'n' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid artifact id',
    });

    // Routines / deployments / plugins
    await expect(client.updateRoutine(blank, { name: 'R' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid routine id',
    });
    await expect(client.deleteRoutine(trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid routine id',
    });
    await expect(client.runRoutineNow(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid routine id',
    });
    await expect(client.listRoutineRuns(blank)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid routine id',
    });
    await expect(client.crystallizeRoutineRun(bad, 'run-1')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid routine id',
    });
    await expect(client.crystallizeRoutineRun('r-1', trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid run id',
    });
    await expect(client.refreshDeployment(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid deployment id',
    });
    await expect(client.resumePlugin(trav, 'run-1', 'stage', {})).resolves.toMatchObject({
      ok: false,
      error: 'Invalid plugin id',
    });
    await expect(client.resumePlugin('p-1', bad, 'stage', {})).resolves.toMatchObject({
      ok: false,
      error: 'Invalid run id',
    });

    // Workflows / runs / webhook / revisions
    await expect(client.getWorkflow(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.updateWorkflow(blank, { name: 'W' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.deleteWorkflow(trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.duplicateWorkflow(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.deleteWorkflowRun(bad, 'run-1')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.deleteWorkflowRun('wf-1', trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid run id',
    });
    await expect(client.preflightWorkflow(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.getWebhookSecret(blank)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.regenerateWebhookSecret(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.testWebhookFire(blank)).resolves.toMatchObject({
      ok: false,
      status: 0,
      error: 'Invalid workflow id',
    });
    await expect(client.listRevisions(trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.getRevision(bad, 'rev-1')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.getRevision('wf-1', trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid revision id',
    });
    await expect(client.restoreRevision(blank, 'rev-1')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.restoreRevision('wf-1', bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid revision id',
    });
    await expect(client.updateRevisionLabel(trav, 'rev-1', 'L')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.updateRevisionLabel('wf-1', blank, 'L')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid revision id',
    });
    await expect(client.deleteRevision(bad, 'rev-1')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.deleteRevision('wf-1', trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid revision id',
    });

    // Deployments / harness / blocks / memory
    await expect(client.listDeployments(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(client.deleteDeployment(trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid deployment id',
    });
    await expect(client.updateWorker(bad, { name: 'W' } as never)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid worker id',
    });
    await expect(client.deleteWorker(blank)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid worker id',
    });
    await expect(client.updateBlock(trav, { name: 'B' } as never)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid block id',
    });
    await expect(client.deleteBlock(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid block id',
    });
    await expect(client.updateMemory(blank, { content: 'c' } as never)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid memory id',
    });
    await expect(client.deleteMemory(trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid memory id',
    });
    await expect(client.toggleMemory(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid memory id',
    });

    // SSE / streaming id gates
    const chatChunks: unknown[] = [];
    for await (const c of client.chat(bad, 'hi')) chatChunks.push(c);
    expect(chatChunks).toEqual([{ type: 'error', content: 'Invalid session id' }]);

    const agentChunks: unknown[] = [];
    for await (const c of client.runAgent(blank, 'hi')) agentChunks.push(c);
    expect(agentChunks).toEqual([{ type: 'error', error: 'Invalid session id' }]);

    const pluginEvents: unknown[] = [];
    const { runIdPromise } = client.runPlugin(trav, {}, (e) => pluginEvents.push(e));
    await expect(runIdPromise).resolves.toBeNull();
    expect(pluginEvents).toEqual([{ type: 'error', error: 'Invalid plugin id' }]);

    const wfEvents: unknown[] = [];
    client.runWorkflow(bad, (e) => wfEvents.push(e));
    await Promise.resolve();
    await Promise.resolve();
    expect(wfEvents).toEqual([
      { type: 'run.failed', runId: '', error: 'Invalid workflow id' },
    ]);

    expect(fetchMock).not.toHaveBeenCalled();
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

  it('rejects control-char / blank auth tokens (no Authorization header)', async () => {
    const client = new EngineClient('http://engine.test');
    client.setAuthToken(`sec${'\0'}ret`);
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listSessions();
    const headers = fetchMock.mock.calls.at(-1)![1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();

    client.setAuthToken(`tok${'\n'}bad`);
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listSessions();
    expect(
      (fetchMock.mock.calls.at(-1)![1].headers as Record<string, string>).Authorization,
    ).toBeUndefined();

    client.setAuthToken('   ');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listSessions();
    expect(
      (fetchMock.mock.calls.at(-1)![1].headers as Record<string, string>).Authorization,
    ).toBeUndefined();

    // null clears prior good token
    client.setAuthToken('good-token');
    client.setAuthToken(null);
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listSessions();
    expect(
      (fetchMock.mock.calls.at(-1)![1].headers as Record<string, string>).Authorization,
    ).toBeUndefined();

    // trims valid tokens
    client.setAuthToken('  trimmed  ');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listSessions();
    expect(
      (fetchMock.mock.calls.at(-1)![1].headers as Record<string, string>).Authorization,
    ).toBe('Bearer trimmed');
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
    // domain-only input is upgraded to primaryDomain for v2 API shape
    const createBody = JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body));
    expect(createBody.primaryDomain).toBe('general');

    fetchMock.mockClear();
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: {} }));
    await client.createWorkflow({
      name: 'Research',
      primaryDomain: 'research',
      domainPackIds: ['research', 'coding'],
    });
    const createV2 = JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body));
    expect(createV2.primaryDomain).toBe('research');
    expect(createV2.domainPackIds).toEqual(['research', 'coding']);

    await client.updateWorkflow('w1', {
      name: 'N2',
      primaryDomain: 'coding',
      domainPackIds: ['coding'],
    });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');
    const updateBody = JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body));
    expect(updateBody.primaryDomain).toBe('coding');

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

  it('exportWorkflow triggers download when ok and scrubs download basename', async () => {
    const client = new EngineClient('http://engine.test');
    const okJson = () =>
      new Response(new Blob(['{}'], { type: 'application/json' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    fetchMock
      .mockResolvedValueOnce(okJson())
      .mockResolvedValueOnce(okJson())
      .mockResolvedValueOnce(okJson());

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

    const ok = await client.exportWorkflow('w1', 'My Workflow!');
    expect(ok).toBe(true);
    expect(click).toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    const anchors = () =>
      createElement.mock.results
        .map((r) => r.value as { download?: string })
        .filter((el) => typeof el?.download === 'string');
    expect(anchors().at(-1)?.download).toBe('My_Workflow.neos.json');

    // Control chars / empty → safe fallback basename
    await client.exportWorkflow('w1', `bad${'\0'} name${'\n'}x`);
    expect(anchors().at(-1)?.download).toBe('bad_name_x.neos.json');
    expect(anchors().at(-1)?.download).not.toMatch(/[\0\r\n]/);

    await client.exportWorkflow('w1', `\0\n!!!`);
    expect(anchors().at(-1)?.download).toBe('workflow.neos.json');

    createElement.mockRestore();
    urlProto.createObjectURL = prevCreate;
    urlProto.revokeObjectURL = prevRevoke;
  });

  it('exportWorkflow returns false when response not ok', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    const createObjectURL = vi.fn();
    const urlProto = URL as unknown as { createObjectURL?: typeof createObjectURL };
    const prevCreate = urlProto.createObjectURL;
    urlProto.createObjectURL = createObjectURL;
    const ok = await client.exportWorkflow('w1', 'x');
    expect(ok).toBe(false);
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

  it('design project endpoints', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: [] }));
    await client.listProjects();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/projects$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'p1', name: 'N' } }));
    await client.createProject({ name: 'N' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { path: 'index.html', content: '<a/>', hash: 'h' } }));
    await client.readProjectFile('p1', 'index.html');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/files/index.html');

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { path: 'a/b.html', hash: 'x', bytes: 1, created: true },
      }),
    );
    await expect(client.writeProjectFile('p1', 'a/b.html', '<b/>')).resolves.toMatchObject({
      ok: true,
      data: { path: 'a/b.html', hash: 'x', bytes: 1, created: true },
    });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/files/a/b.html');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toEqual({
      content: '<b/>',
      source: 'user',
    });

    // sessionId for NEOS_SHARED_EDIT hard-enforce lock holder
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { path: 'a/b.html', hash: 'y', bytes: 1, created: false },
      }),
    );
    await expect(
      client.writeProjectFile('p1', 'a/b.html', '<b2/>', 'user', { sessionId: 'sess-abc' }),
    ).resolves.toMatchObject({ ok: true, data: { hash: 'y' } });
    const lockedWrite = fetchMock.mock.calls.at(-1)![1] as {
      method: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(lockedWrite.method).toBe('PUT');
    expect(lockedWrite.headers['x-neos-session-id']).toBe('sess-abc');
    expect(JSON.parse(lockedWrite.body)).toEqual({
      content: '<b2/>',
      source: 'user',
      sessionId: 'sess-abc',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { path: 'a/b.html' } }));
    await client.deleteProjectFile('p1', 'a/b.html');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/files/a/b.html');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');
    // no session → no body / session header
    {
      const delPlain = fetchMock.mock.calls.at(-1)![1] as {
        headers: Record<string, string>;
        body?: string;
      };
      expect(delPlain.headers['x-neos-session-id']).toBeUndefined();
      expect(delPlain.body).toBeUndefined();
    }

    // sessionId for NEOS_SHARED_EDIT hard-enforce on delete
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { path: 'a/b.html' } }));
    await client.deleteProjectFile('p1', 'a/b.html', { sessionId: 'sess-del' });
    const delLocked = fetchMock.mock.calls.at(-1)![1] as {
      method: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(delLocked.method).toBe('DELETE');
    expect(delLocked.headers['x-neos-session-id']).toBe('sess-del');
    expect(JSON.parse(delLocked.body)).toEqual({ sessionId: 'sess-del' });

    const bad = await client.readProjectFile('p1', '../etc/passwd');
    expect(bad.ok).toBe(false);
    await expect(client.deleteProjectFile('p1', '../etc/passwd')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid file path',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { peers: [] } }));
    await client.listCollabPeers('p1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/collab\/peers$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { locks: [] } }));
    await client.listCollabLocks('p1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/collab\/locks$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { selections: [] } }));
    await client.listCollabSelections('p1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/collab\/selections$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { touched: true } }));
    await client.collabHeartbeat('p1', { sessionId: 's1', displayName: 'Desktop' });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/collab\/heartbeat$/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
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
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/settings/verify-key');
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

    await client.createMcpServerFromPreset({
      presetId: 'tradingview',
      installPath: '/tmp/tv',
      name: 'TradingView',
    });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/from-preset/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toEqual({
      presetId: 'tradingview',
      installPath: '/tmp/tv',
      name: 'TradingView',
    });

    await client.checkTradingViewCdp(9222);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(
      /tradingview\/cdp-health\?port=9222/,
    );
    await client.checkTradingViewCdp();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/tradingview\/cdp-health$/);
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

    // listHarnesses prefers /api/workers (v0.4); falls back to /api/harness only on failure
    await client.listHarnesses();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/workers/);

    fetchMock.mockClear();
    await client.listWorkers('  Research  ');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/workers?domain=research');

    fetchMock.mockClear();
    await client.listWorkers(`bad${'\n'}domain`);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/workers$/);
    expect(String(fetchMock.mock.calls.at(-1)![0])).not.toContain('domain=');

    fetchMock.mockClear();
    await client.listDomainPacks();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/domain-packs$/);

    // When workers API fails, listHarnesses falls back to harness alias
    fetchMock.mockClear();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: 'gone' }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listHarnesses();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/harness$/);

    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: [] }));

    await client.getTemplates();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/template/);

    await client.listWorkspaces();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/workspace/);

    await expect(client.createWorkspace({ name: '' })).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/name/i),
    });
    await expect(client.createWorkspace({ name: `bad${'\n'}n` })).resolves.toMatchObject({
      ok: false,
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'ws-new', name: 'Lab', type: 'local' } }),
    );
    const created = await client.createWorkspace({
      name: '  Lab  ',
      path: '  /Users/me/lab  ',
    });
    expect(created.ok).toBe(true);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toEqual({
      name: 'Lab',
      path: '/Users/me/lab',
    });

    await expect(client.updateWorkspace('', { name: 'X' })).resolves.toMatchObject({
      ok: false,
    });
    await expect(client.updateWorkspace('ws-new', { name: `bad${'\n'}` })).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/name/i),
    });
    await expect(
      client.updateWorkspace('ws-new', { path: `bad${'\0'}path` }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/path/i) });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { id: 'ws-new', name: 'Lab2', type: 'local', path: '/Users/me/lab2' },
      }),
    );
    await client.updateWorkspace('ws-new', { name: '  Lab2  ', path: ' /Users/me/lab2 ' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toEqual({
      name: 'Lab2',
      path: '/Users/me/lab2',
    });

    await expect(client.deleteWorkspace('default')).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/default/i),
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client.deleteWorkspace('ws-new');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/workspace\/ws-new$/);
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

  it('normalizeProjectRelPath mirrors server lock path rules', () => {
    expect(normalizeProjectRelPath('a/b.html')).toBe('a/b.html');
    expect(normalizeProjectRelPath('/abs')).toBe('abs');
    expect(normalizeProjectRelPath('  a\\b.html  ')).toBe('a/b.html');
    expect(normalizeProjectRelPath('../x')).toBe('');
    expect(normalizeProjectRelPath('~/x')).toBe('');
    expect(normalizeProjectRelPath('C:/Windows')).toBe('');
    expect(normalizeProjectRelPath(`a${'\0'}b`)).toBe('');
    expect(normalizeProjectRelPath('x'.repeat(501))).toBe('');
    expect(normalizeProjectRelPath(null)).toBe('');
  });

  it('parseSseDataPayload / parseSseEventName reject control-char payloads', () => {
    expect(parseSseDataPayload('data: {"ok":true}')).toBe('{"ok":true}');
    expect(parseSseDataPayload('data: {"ok":true}\r')).toBe('{"ok":true}');
    expect(parseSseDataPayload(`data: {"x":1${'\0'}}`)).toBeNull();
    expect(parseSseDataPayload('data:')).toBeNull();
    expect(parseSseDataPayload('data:   ')).toBeNull();
    expect(parseSseDataPayload('event: foo')).toBeNull();
    expect(parseSseDataPayload('not-data')).toBeNull();
    expect(parseSseDataPayload(null as unknown as string)).toBeNull();
    // "data:" without space and with space
    expect(parseSseDataPayload('data:{"a":1}')).toBe('{"a":1}');
    expect(parseSseEventName('event: tool_call')).toBe('tool_call');
    expect(parseSseEventName('event:  padded  ')).toBe('padded');
    expect(parseSseEventName(`event: bad${'\0'}name`)).toBe('');
    expect(parseSseEventName('event: \nlead')).toBe('');
    expect(parseSseEventName('event:')).toBe('');
    expect(parseSseEventName('data: x')).toBe('');
    expect(parseSseEventName(42 as unknown as string)).toBe('');
  });

  it('runWorkflow skips null-byte SSE data lines', async () => {
    const client = new EngineClient('http://engine.test');
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: {"type":"run.started","runId":"r1"}\n\ndata: {"type":"evil${'\0'}","runId":"x"}\n\ndata: {"type":"run.completed","runId":"r1","duration":1}\n\n`,
          ),
        );
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const events: unknown[] = [];
    client.runWorkflow('w1', (e) => events.push(e));
    await vi.waitFor(() => {
      expect(events.length).toBe(2);
    });
    expect(events[0]).toMatchObject({ type: 'run.started' });
    expect(events[1]).toMatchObject({ type: 'run.completed' });
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

    await client.deleteRoutine('r1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');
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
    expect(errChunks[0]).toMatchObject({ type: 'error', content: 'HTTP 500: Err' });

    // Control-char statusText scrubbed in chat HTTP errors (mock Response-like; ctor rejects controls)
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: `Bad${'\0'}Gateway\nnow`,
      body: null,
    });
    const dirty: unknown[] = [];
    for await (const c of client.chat('s1', 'y')) {
      dirty.push(c);
    }
    expect(dirty[0]).toEqual({ type: 'error', content: 'HTTP 502: BadGateway now' });
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
    expect(err[0]).toMatchObject({ type: 'error', error: 'HTTP 503: Down' });

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 504,
      statusText: `Time${'\n'}out${'\0'}`,
      body: null,
    });
    const dirtyAgent: unknown[] = [];
    for await (const c of client.runAgent('s1', 'y')) {
      dirtyAgent.push(c);
    }
    expect(dirtyAgent[0]).toEqual({ type: 'error', error: 'HTTP 504: Time out' });
  });

  it('formatHttpErrorMessage / scrubApiErrorMessage collapse control chars', () => {
    expect(formatHttpErrorMessage(500, 'Internal')).toBe('HTTP 500: Internal');
    expect(formatHttpErrorMessage(502, `Bad${'\0'}Gateway\r\nX`)).toBe('HTTP 502: BadGateway X');
    expect(formatHttpErrorMessage(404, '\0\n')).toBe('HTTP 404');
    expect(formatHttpErrorMessage(Number.NaN, 'x')).toBe('HTTP 0: x');
    expect(scrubApiErrorMessage(`disk${'\n'}full${'\0'}!`)).toBe('disk full!');
    expect(scrubApiErrorMessage('\0\r\n', 'fallback')).toBe('fallback');
    expect(scrubApiErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('readApiResponse returns envelope or scrubbed failure without throwing', async () => {
    const okRes = new Response(JSON.stringify({ ok: true, data: { id: 'x' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(readApiResponse(okRes)).resolves.toEqual({ ok: true, data: { id: 'x' } });

    // Response ctor rejects control-char statusText — stub getters
    const badJson = new Response('not-json{', {
      status: 502,
      statusText: 'Bad Gateway',
      headers: { 'Content-Type': 'application/json' },
    });
    Object.defineProperty(badJson, 'statusText', {
      value: `Bad${'\n'}Gateway${'\0'}!`,
    });
    const failed = await readApiResponse(badJson);
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/Bad Gateway|HTTP 502/);
    expect(failed.error).not.toContain('\0');
    expect(failed.error).not.toMatch(/[\r\n]/);

    const nonObject = new Response(JSON.stringify('plain'), { status: 200 });
    const plain = await readApiResponse(nonObject);
    expect(plain.ok).toBe(false);

    // JSON arrays are typeof object — must not be treated as envelopes
    const arr = new Response(JSON.stringify([{ ok: true }]), { status: 200 });
    const arrRes = await readApiResponse(arr);
    expect(arrRes.ok).toBe(false);
    expect(arrRes.error).toBeTruthy();

    // Control-char error on valid envelope is scrubbed at parse time
    const dirty = new Response(
      JSON.stringify({ ok: false, error: `quota${'\n'}full${'\0'}!` }),
      { status: 400 },
    );
    const scrubbed = await readApiResponse(dirty);
    expect(scrubbed.ok).toBe(false);
    expect(scrubbed.error).toBe('quota full!');
  });

  it('readHealthResponse parses ok body and throws clean error on invalid JSON', async () => {
    const ok = new Response(JSON.stringify({ status: 'ok', version: '0.3.162' }), {
      status: 200,
    });
    await expect(readHealthResponse(ok)).resolves.toMatchObject({ status: 'ok', version: '0.3.162' });

    const bad = new Response('<html>nope</html>', {
      status: 503,
      statusText: 'Service Unavailable',
    });
    await expect(readHealthResponse(bad)).rejects.toThrow(/HTTP 503/);

    // Array body is not a health envelope
    const arr = new Response(JSON.stringify([{ status: 'ok' }]), { status: 200 });
    await expect(readHealthResponse(arr)).rejects.toThrow(/HTTP 200/);
  });

  it('worker CRUD and deprecated harness aliases hit /api/workers', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: {} }));

    await client.createWorker({
      name: 'W',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'p',
      allowedTools: [],
      permissionProfile: 'execute',
      defaultMode: 'solo',
      workspace: { kind: 'isolated' },
    });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/workers$/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.updateWorker('w1', { name: 'W2' });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/workers\/w1$/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');

    await client.deleteWorker('w1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/workers\/w1$/);
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

  it('MCP OAuth start', async () => {
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

    // non-ok plugin run → null runId
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const failed = client.runPlugin('p1', {}, () => {});
    await expect(failed.runIdPromise).resolves.toBeNull();

    // Invalid plugin id fails closed without fetch; surfaces error event
    fetchMock.mockClear();
    const badIdEvents: unknown[] = [];
    const badIdRun = client.runPlugin(`p${'\n'}x`, {}, (e) => badIdEvents.push(e));
    await expect(badIdRun.runIdPromise).resolves.toBeNull();
    expect(badIdEvents).toEqual([{ type: 'error', error: 'Invalid plugin id' }]);
    expect(fetchMock).not.toHaveBeenCalled();

    // malformed SSE chunks ignored; still extracts runId from valid event
    const badStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: not-json\n\n'));
        controller.enqueue(
          encoder.encode('data: {"type":"pipeline.started","runId":"run-ok"}\n\n'),
        );
        controller.enqueue(encoder.encode('data: {"type":"stage.done"}\n\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(badStream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const events2: unknown[] = [];
    const okRun = client.runPlugin('p2', {}, (e) => events2.push(e));
    await expect(okRun.runIdPromise).resolves.toBe('run-ok');
    expect(events2.some((e) => (e as { type?: string }).type === 'stage.done')).toBe(true);

    // Control-char pipeline runId ignored (never captured)
    const ctrlRunStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: {"type":"pipeline.started","runId":"bad${'\0'}id"}\n\n`,
          ),
        );
        controller.enqueue(
          encoder.encode('data: {"type":"pipeline.started","runId":"  run-clean  "}\n\n'),
        );
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(ctrlRunStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const ctrlRun = client.runPlugin('p3', {}, () => {});
    await expect(ctrlRun.runIdPromise).resolves.toBe('run-clean');

    // export zip download
    const zipOk = () => new Response(new Blob(['zip']), { status: 200 });
    fetchMock
      .mockResolvedValueOnce(zipOk())
      .mockResolvedValueOnce(zipOk())
      .mockResolvedValueOnce(zipOk());
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
    const zipOkResult = await client.exportWorkflowZip('w1', 'out.zip');
    expect(zipOkResult).toBe(true);
    expect(click).toHaveBeenCalled();
    // Control / spaces sanitized to download-safe basename
    await client.exportWorkflowZip('w1', `bad${'\n'} name.zip`);
    const anchors = () =>
      createElement.mock.results
        .map((r) => r.value as { download?: string })
        .filter((el) => typeof el?.download === 'string');
    expect(anchors().at(-1)?.download).toBe('bad_name.zip');
    expect(anchors().at(-1)?.download).not.toMatch(/[\0\r\n]/);
    await client.exportWorkflowZip('w1', `\0\n`);
    expect(anchors().at(-1)?.download).toBe('workflow.zip');

    createElement.mockRestore();
    urlProto.createObjectURL = prevCreate;
    urlProto.revokeObjectURL = prevRevoke;

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const zipFail = await client.exportWorkflowZip('w1', 'nope.zip');
    expect(zipFail).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'w' } }));
    const file = new File(['z'], 'd.zip', { type: 'application/zip' });
    await client.importClaudeDesignZip(file);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/claude|import/i);
    expect(fetchMock.mock.calls.at(-1)![1].body).toBeInstanceOf(FormData);
  });

  it('design project validation and CRUD paths', async () => {
    const client = new EngineClient('http://engine.test');

    // createImportToken validation
    await expect(client.createImportToken('')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid path',
    });
    await expect(client.createImportToken(`bad${'\n'}path`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid path',
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { token: 't1', path: '/tmp/x', expiresAt: 't', expiresInMs: 1 },
      }),
    );
    const tok = await client.createImportToken('/tmp/x');
    expect(tok.ok).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/import-token/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    // createProject validation
    await expect(client.createProject({ name: '' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid name',
    });
    await expect(client.createProject({ name: `n${'\0'}x` })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid name',
    });
    await expect(
      client.createProject({ name: 'ok', baseDir: `b${'\n'}d` }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid baseDir' });
    await expect(
      client.createProject({ name: 'ok', importToken: `tok${'\0'}` }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid importToken' });

    // get/update/delete project
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'p1' } }));
    await client.getProject('p1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/projects\/p1$/);

    await expect(client.getProject(`p${'\n'}1`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid project id',
    });

    await expect(
      client.updateProject('p1', { name: `bad${'\n'}` }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid name' });
    await expect(
      client.updateProject('p1', { baseDir: `b${'\0'}` }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid baseDir' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'p1', name: 'U' } }));
    await client.updateProject('p1', { name: 'U', designSystemId: 'ds1' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }));
    await client.deleteProject('p1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');
    await expect(client.deleteProject('')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid project id',
    });
  });

  it('export/import project zip and file helpers', async () => {
    const client = new EngineClient('http://engine.test');

    await expect(client.exportProjectZip(`p${'\n'}x`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid project id',
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'nope' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(client.exportProjectZip('p1')).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/nope|HTTP|Export/i),
    });

    const emptyBlob = { size: 0 } as Blob;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => emptyBlob,
      json: async () => ({}),
    } as Response);
    await expect(client.exportProjectZip('p1')).resolves.toMatchObject({
      ok: false,
      error: 'Empty export',
    });

    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['PK'], { type: 'application/zip' }), { status: 200 }),
    );
    const zipOk = await client.exportProjectZip('p1');
    expect(zipOk.ok).toBe(true);
    if (zipOk.ok) expect(zipOk.blob.size).toBeGreaterThan(0);

    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(client.exportProjectZip('p1')).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/network|Export/i),
    });

    // import zip
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { project: { id: 'p2' }, filesImported: 1 } }),
    );
    const imp = await client.importProjectZip(new Blob(['PK'], { type: 'application/zip' }));
    expect(imp.ok).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/import\.zip/);
    expect((fetchMock.mock.calls.at(-1)![1].headers as Record<string, string>)['Content-Type']).toBe(
      'application/zip',
    );

    fetchMock.mockRejectedValueOnce(new Error('import down'));
    await expect(client.importProjectZip(new ArrayBuffer(2))).resolves.toMatchObject({
      ok: false,
      error: 'import down',
    });

    // list files / mkdir / revisions / comments / runs
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: [] }));
    await client.listProjectFiles('p1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/files$/);

    await expect(client.mkdirProjectPath('p1', '')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid path',
    });
    await expect(client.mkdirProjectPath('p1', `d${'\n'}`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid path',
    });
    await client.mkdirProjectPath('p1', 'src/components');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toEqual({
      path: 'src/components',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { path: 'locked-dir' } }));
    await client.mkdirProjectPath('p1', 'locked-dir', { sessionId: 'sess-mkdir' });
    const mkdirLocked = fetchMock.mock.calls.at(-1)![1] as {
      method: string;
      headers: Record<string, string>;
      body: string;
    };
    expect(mkdirLocked.method).toBe('POST');
    expect(mkdirLocked.headers['x-neos-session-id']).toBe('sess-mkdir');
    expect(JSON.parse(mkdirLocked.body)).toEqual({
      path: 'locked-dir',
      sessionId: 'sess-mkdir',
    });

    await client.listProjectRevisions('p1', 'index.html');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('path=index.html');
    await expect(client.listProjectRevisions('p1', `x${'\n'}`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid file path',
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
          id: 'rev1',
          projectId: 'p1',
          path: 'index.html',
          contentHash: 'deadbeef',
          content: '<html>old</html>',
          source: 'user',
          createdAt: '2020-01-01T00:00:00.000Z',
        },
      }),
    );
    const got = await client.getProjectRevision('p1', 'rev1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/revisions\/rev1$/);
    expect(got.ok && got.data?.content).toBe('<html>old</html>');
    await expect(client.getProjectRevision('p1', `r${'\0'}`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid revision id',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { path: 'index.html', hash: 'h' } }));
    await client.restoreProjectRevision('p1', 'rev1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/restore/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { path: 'index.html', hash: 'h2' } }));
    await client.restoreProjectRevision('p1', 'rev1', { sessionId: 'sess-restore' });
    const restoreCall = fetchMock.mock.calls.at(-1)![1] as {
      method: string;
      headers: Record<string, string>;
      body?: string;
    };
    expect(restoreCall.method).toBe('POST');
    expect(restoreCall.headers['x-neos-session-id']).toBe('sess-restore');
    expect(JSON.parse(String(restoreCall.body))).toEqual({ sessionId: 'sess-restore' });

    await expect(client.restoreProjectRevision('p1', `r${'\0'}`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid revision id',
    });

    // project conversations / messages
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: [
          {
            id: 'conv1',
            projectId: 'p1',
            title: 'Project chat',
            createdAt: 't0',
            updatedAt: 't1',
          },
        ],
      }),
    );
    await expect(client.listProjectConversations('p1')).resolves.toMatchObject({
      ok: true,
      data: [{ id: 'conv1' }],
    });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/conversations$/);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
          id: 'conv2',
          projectId: 'p1',
          title: 'New',
          createdAt: 't0',
          updatedAt: 't0',
        },
      }),
    );
    await client.createProjectConversation('p1', 'New');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toEqual({ title: 'New' });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: [
          {
            id: 'm1',
            conversationId: 'conv1',
            role: 'user',
            content: 'hi',
            createdAt: 't0',
          },
        ],
      }),
    );
    await client.listProjectMessages('p1', 'conv1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/conversations\/conv1\/messages$/);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
          id: 'm2',
          conversationId: 'conv1',
          role: 'user',
          content: 'hello',
          createdAt: 't1',
        },
      }),
    );
    await client.addProjectMessage('p1', 'conv1', { role: 'user', content: 'hello' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toEqual({
      content: 'hello',
      role: 'user',
    });

    await client.listProjectPreviewComments('p1', 'index.html');
    await expect(client.listProjectPreviewComments('p1', `f${'\n'}`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid file path',
    });

    await expect(
      client.createProjectPreviewComment('p1', {
        filePath: 'a.html',
        selector: '#x',
        body: `bad${'\0'}`,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid comment fields' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'c1' } }));
    await client.createProjectPreviewComment('p1', {
      filePath: 'a.html',
      selector: '#x',
      body: 'note',
    });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }));
    await client.deleteProjectPreviewComment('p1', 'c1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');
    await expect(client.deleteProjectPreviewComment('p1', '')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid comment id',
    });

    // writeProjectFile content validation
    await expect(client.writeProjectFile('p1', 'a.html', `x${'\0'}`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid content',
    });
  });

  it('project run endpoints', async () => {
    const client = new EngineClient('http://engine.test');

    await expect(
      client.createProjectRun({ projectId: 'p1', prompt: `bad${'\0'}prompt` }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid prompt' });

    await expect(
      client.createProjectRun({ projectId: `p${'\n'}1`, prompt: 'hi' }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid project id' });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'run1', status: 'running' } }),
    );
    const run = await client.createProjectRun({
      projectId: 'p1',
      prompt: 'Improve hero',
      dryRun: true,
      editContext: { filePath: 'index.html', mode: 'patch', snippet: '<html/>' },
    });
    expect(run.ok).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/runs/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'run1', status: 'succeeded' } }));
    await client.getProjectRun('run1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/project-runs|runs/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listProjectRunEvents('run1', 'ev0');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/events/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }));
    await client.cancelProjectRun('run1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    await expect(client.cancelProjectRun(`r${'\n'}`)).resolves.toMatchObject({ ok: false });
  });


  it('createProjectRun rejects overlong prompt and bad agentId', async () => {
    const client = new EngineClient('http://engine.test');
    await expect(
      client.createProjectRun({ prompt: 'x'.repeat(100_001) }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'prompt exceeds max length (100000)',
    });
    await expect(
      client.createProjectRun({ prompt: 'hi', agentId: `cli${'\n'}x` }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid agentId' });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'run2', status: 'running' } }),
    );
    const res = await client.createProjectRun({
      prompt: 'ok',
      agentId: 'cli-claude',
      execute: false,
      dryRun: true,
    });
    expect(res.ok).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(body.agentId).toBe('cli-claude');
    expect(body.execute).toBe(false);
    expect(body.dryRun).toBe(true);
  });

  it('design system content/tokens/save and live artifact APIs', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: {} }));

    await client.createDesignSystem('Brand', 'desc');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/design-systems/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.getDesignSystemContent('ds1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/content/);
    await client.getDesignSystemTokens('ds1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/tokens/);
    await client.saveDesignSystemContent('ds1', '# hello');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');
    await client.deleteDesignSystem('ds1');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await expect(client.getDesignSystemTokens(`d${'\n'}s`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid design system id',
    });
    await expect(client.saveDesignSystemContent('', 'x')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid design system id',
    });

    // live artifacts
    await expect(client.listLiveArtifacts(`p${'\0'}x`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid project id',
    });
    await client.listLiveArtifacts('p1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/live-artifacts/);

    await expect(
      client.createLiveArtifact({ projectId: 'p1', name: `bad${'\n'}` }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid name' });
    await expect(
      client.createLiveArtifact({ projectId: `p${'\n'}1`, name: 'ok' }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid project id' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'la1', name: 'Live' } }));
    const created = await client.createLiveArtifact({
      projectId: 'p1',
      name: '  Live  ',
      sourceTemplate: 'tpl',
      contentType: 'text/html',
    });
    expect(created.ok).toBe(true);
    const liveBody = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(liveBody.name).toBe('Live');
    expect(liveBody.projectId).toBe('p1');
  });


  it('live artifact refresh/delete and tool token APIs', async () => {
    const client = new EngineClient('http://engine.test');

    await expect(client.refreshLiveArtifact('', 'p1')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid id',
    });
    await expect(client.refreshLiveArtifact('a1', `p${'\n'}x`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid id',
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { artifact: { id: 'a1' }, refresh: { id: 'r1' } } }),
    );
    const ref = await client.refreshLiveArtifact('a1', 'p1', { title: 'x' });
    expect(ref.ok).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/refresh/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(body.inputs).toEqual({ title: 'x' });

    await expect(client.deleteLiveArtifact(`a${'\0'}`, 'p1')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid id',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: null }));
    const del = await client.deleteLiveArtifact('a1', 'p1');
    expect(del.ok).toBe(true);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');
  });


  it('checkDeployLink, getMediaJob, and listMediaProviders', async () => {
    const client = new EngineClient('http://engine.test');

    await expect(client.checkDeployLink('')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid url',
    });
    await expect(client.checkDeployLink(`https://x${'\n'}.example`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid url',
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { url: 'https://ok.example', reachable: true, blocked: false, ok: true, status: 200 },
      }),
    );
    const chk = await client.checkDeployLink('  https://ok.example  ');
    expect(chk.ok).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/check-link/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    const body = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(body.url).toBe('https://ok.example');

    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: [] }));
    await client.listMediaProviders();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/media\/providers/);

    await expect(client.getMediaJob(`j${'\0'}x`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid job id',
    });
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'job1', status: 'succeeded', provider: 'openai', surface: 'workflow' } }),
    );
    const job = await client.getMediaJob('job1');
    expect(job.ok).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/media\/jobs\/job1/);
  });

  it('generateMedia posts unified generate body and validates prompt/text', async () => {
    const client = new EngineClient('http://engine.test');

    await expect(client.generateMedia({ surface: 'image', prompt: '' })).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/prompt/i),
    });
    await expect(
      client.generateMedia({ surface: 'image', prompt: `bad${'\n'}line` }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/prompt/i) });
    await expect(client.generateMedia({ surface: 'audio', text: '' })).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/text/i),
    });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { surface: 'image', filename: 'out.png' } }),
    );
    const img = await client.generateMedia({
      surface: 'image',
      prompt: '  a cat  ',
      provider: 'openai',
    });
    expect(img.ok).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/media\/generate$/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    const imgBody = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(imgBody).toEqual({ surface: 'image', prompt: 'a cat', provider: 'openai' });

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { surface: 'audio', filename: 'a.mp3' } }),
    );
    await client.generateMedia({ surface: 'audio', text: 'hello world', voice: 'alloy' });
    const audioBody = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(audioBody).toMatchObject({ surface: 'audio', text: 'hello world', voice: 'alloy' });
    expect(audioBody.prompt).toBeUndefined();
  });


  it('runPlugin accepts bare JSON SSE parts and exportProjectZip non-json errors', async () => {
    const client = new EngineClient('http://engine.test');
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // bare JSON without data: prefix
        controller.enqueue(encoder.encode('{"type":"pipeline.started","runId":"run-bare"}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"step","msg":"ok"}\n\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const events: unknown[] = [];
    const { runIdPromise } = client.runPlugin('plug-1', {}, (e) => events.push(e));
    await expect(runIdPromise).resolves.toBe('run-bare');
    expect(events.some((e) => (e as { type?: string }).type === 'pipeline.started')).toBe(true);

    // non-ok export with non-json body → HTTP status fallback
    fetchMock.mockResolvedValueOnce(
      new Response('not-json', { status: 502, headers: { 'Content-Type': 'text/plain' } }),
    );
    await expect(client.exportProjectZip('p1')).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/HTTP 502|Export/i),
    });
  });

  it('MCP install-info / codex install / domain-pack CRUD coverage', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock.mockImplementation(async () => jsonResponse({ ok: true, data: {} }));

    await client.getMcpInstallInfo({ projectId: '  proj-1  ', includeToken: false });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/mcp\/install-info\?/);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/projectId=proj-1/);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/includeToken=0/);

    // control-char projectId ignored
    await client.getMcpInstallInfo({ projectId: `p${'\n'}1` });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/mcp\/install-info$/);

    await client.getCodexMcpInstallStatus();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/install\/codex\/status/);

    await client.installCodexMcp({
      projectId: '  p1  ',
      neosBin: '  /usr/local/bin/neos  ',
    });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    const installBody = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string);
    expect(installBody.projectId).toBe('p1');
    expect(installBody.neosBin).toBe('/usr/local/bin/neos');

    // control-char params stripped
    await client.installCodexMcp({ projectId: `x${'\0'}y`, neosBin: `bin${'\n'}` });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)).toEqual({});

    await client.uninstallCodexMcp();
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await client.installDomainPackFromPath('/tmp/pack');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)).toEqual({
      path: '/tmp/pack',
    });

    await client.toggleDomainPack('legal', false);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/legal\/toggle/);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)).toEqual({ enabled: false });

    await client.deleteDomainPack('legal');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('DELETE');

    await expect(client.toggleDomainPack('', true)).resolves.toMatchObject({ ok: false });
    await expect(client.deleteDomainPack(`x${'\0'}`)).resolves.toMatchObject({ ok: false });
  });

  it('streamProjectFileEvents parses SSE and aborts cleanly', async () => {
    const client = new EngineClient('http://engine.test');
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: ready\ndata: {"projectId":"p1"}\n\nevent: file.changed\ndata: {"projectId":"p1","path":"index.html","source":"user","hash":"abc","ts":"t1"}\n\ndata: not-json\n\n',
          ),
        );
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const events: Array<{ type: string; path?: string }> = [];
    const stop = client.streamProjectFileEvents('p1', (e) => events.push(e));
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'file.changed' && e.path === 'index.html')).toBe(true);
    });
    stop();

    // invalid id returns no-op abort
    const noop = client.streamProjectFileEvents(`p${'\n'}1`, () => {});
    expect(typeof noop).toBe('function');
    noop();
    // last successful fetch only (invalid id does not fetch)
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]).includes('/events/stream')),
    ).toBe(true);
  });

  it('streamProjectRunEvents hits correct URL, parses one event, and aborts', async () => {
    const client = new EngineClient('http://engine.test');
    client.setAuthToken('run-token');
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'id: ev1\nevent: run.stdout\ndata: {"id":"ev1","type":"run.stdout","ts":"t1","data":{"chunk":"hello"}}\n\n',
          ),
        );
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );

    const events: Array<{ type: string; id?: string; ts?: string; data?: unknown }> = [];
    let done = false;
    const stop = client.streamProjectRunEvents(
      'run-abc',
      (e) => events.push(e),
      { onDone: () => { done = true; } },
    );

    await vi.waitFor(() => {
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(done).toBe(true);
    });

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://engine.test/api/runs/run-abc/events/stream',
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'GET',
      headers: expect.objectContaining({
        Accept: 'text/event-stream',
        Authorization: 'Bearer run-token',
      }),
      signal: expect.any(AbortSignal),
    });
    expect(events[0]).toMatchObject({
      type: 'run.stdout',
      id: 'ev1',
      ts: 't1',
      data: { chunk: 'hello' },
    });

    // abort returns cleanly
    stop();

    // invalid id: no fetch, onError, abort is no-op
    const prevCalls = fetchMock.mock.calls.length;
    let err: unknown;
    const noop = client.streamProjectRunEvents(
      `run${'\n'}1`,
      () => {},
      { onError: (e) => { err = e; } },
    );
    await vi.waitFor(() => {
      expect(err).toBeInstanceOf(Error);
    });
    expect(fetchMock.mock.calls.length).toBe(prevCalls);
    expect(typeof noop).toBe('function');
    noop();
  });

  it('listHarnesses falls back to /api/harness when workers fail', async () => {
    const client = new EngineClient('http://engine.test');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: false, error: 'no workers' }, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: [{ id: 'h1', name: 'H' }] }));
    const res = await client.listHarnesses();
    expect(res.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/workers|harness/);
    expect(String(fetchMock.mock.calls[1]![0])).toMatch(/\/api\/harness$/);
  });


});
