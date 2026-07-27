import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EngineClient,
  formatHttpErrorMessage,
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
    expect(client.mediaFileUrl('a b.png')).toBe('');
    expect(client.mediaFileUrl(`bad${'\0'}.png`)).toBe('');
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
    expect(client.mediaFileUrl('img_1.png')).toBe('http://engine.test/api/media/file/img_1.png');
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
    await expect(client.updateWorkspace(blank, { name: 'N' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workspace id',
    });
    await expect(client.deleteWorkspace(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workspace id',
    });
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
    await expect(
      client.refreshMcpOAuth(bad, { tokenEndpoint: 'https://t', clientId: 'c' }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid MCP server id' });

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
    await expect(client.getRoutine(bad)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid routine id',
    });
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
    await expect(client.getPlugin(blank)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid plugin id',
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
    await expect(client.getWebhookRateLimit(trav)).resolves.toMatchObject({
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
    await expect(client.getDeployment(blank)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid deployment id',
    });
    await expect(client.deleteDeployment(trav)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid deployment id',
    });
    await expect(client.updateHarness(bad, { name: 'H' } as never)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid worker id',
    });
    await expect(client.deleteHarness(blank)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid worker id',
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

    await client.listMcpPresets();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/mcp-servers\/presets/);

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

    // Deprecated harness aliases route to workers API
    await client.createHarness({
      id: 'h1',
      name: 'H',
      domain: 'coding',
      description: 'd',
      systemPrompt: 'p',
      allowedTools: [],
    });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/workers$/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');

    await client.updateHarness('h1', { name: 'H2' });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/workers\/h1$/);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('PUT');

    await client.deleteHarness('h1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/workers\/h1$/);
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

    expect(client.mediaFileUrl('photo-1.png')).toBe(
      'http://engine.test/api/media/file/photo-1.png',
    );
    // Spaces / path separators rejected (align with server isSafeMediaFilename)
    expect(client.mediaFileUrl('a b.png')).toBe('');

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
});
