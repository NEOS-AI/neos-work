import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebApiClient } from './api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('WebApiClient hard-enforce session transport', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writeFile sends sessionId in body and x-neos-session-id header', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { path: 'a.html', hash: 'h1', bytes: 1, created: false },
      }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(
      client.writeFile('p1', 'a.html', '<p/>', { sessionId: 'sess-web' }),
    ).resolves.toMatchObject({ ok: true, data: { hash: 'h1' } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/projects/p1/files/a.html');
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-neos-session-id']).toBe('sess-web');
    expect(JSON.parse(String(init.body))).toEqual({
      content: '<p/>',
      source: 'user',
      sessionId: 'sess-web',
    });
  });

  it('writeFile omits session transport when sessionId not provided', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { path: 'a.html', hash: 'h2', bytes: 1, created: false },
      }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    await client.writeFile('p1', 'a.html', 'x');
    const init = fetchMock.mock.calls[0]![1] as {
      headers: Record<string, string>;
      body: string;
    };
    expect(init.headers['x-neos-session-id']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ content: 'x', source: 'user' });
  });

  it('deleteFile sends sessionId body + header for hard-enforce', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { path: 'a.html' } }));
    const client = new WebApiClient('http://engine.test', 'tok');
    await client.deleteFile('p1', 'dir/a.html', { sessionId: 'sess-del' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/files/dir/a.html');
    expect(init.method).toBe('DELETE');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-neos-session-id']).toBe('sess-del');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: 'sess-del' });
  });

  it('deleteFile without sessionId omits body and header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { path: 'a.html' } }));
    const client = new WebApiClient('http://engine.test', 'tok');
    await client.deleteFile('p1', 'a.html');
    const init = fetchMock.mock.calls[0]![1] as {
      method: string;
      headers: Record<string, string>;
      body?: string;
    };
    expect(init.method).toBe('DELETE');
    expect(init.headers['x-neos-session-id']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('createProject posts name and rejects invalid names', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'p-new', name: 'Landing' } }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.createProject({ name: '' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid name',
    });
    const res = await client.createProject({ name: '  Landing  ' });
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/projects$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Landing' });
  });

  it('updateProject puts name and rejects invalid id/name', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'p1', name: 'Renamed' } }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.updateProject('', { name: 'x' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid project id',
    });
    await expect(
      client.updateProject('p1', { name: `bad${'\n'}name` }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid name' });
    await expect(client.updateProject('p1', {})).resolves.toMatchObject({
      ok: false,
      error: 'No fields to update',
    });
    const res = await client.updateProject('p1', { name: '  Renamed  ' });
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/projects\/p1$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Renamed' });
  });

  it('deleteProject sends DELETE and rejects invalid id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.deleteProject(`bad${'\0'}id`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid project id',
    });
    const res = await client.deleteProject('p1');
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/projects\/p1$/);
    expect(init.method).toBe('DELETE');
  });

  it('mkdir sends path body + optional session header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { path: 'assets' } }));
    const client = new WebApiClient('http://engine.test', 'tok');
    await client.mkdir('p1', 'assets/icons', { sessionId: 'sess-mkdir' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/projects\/p1\/mkdir$/);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-neos-session-id']).toBe('sess-mkdir');
    expect(JSON.parse(String(init.body))).toEqual({
      path: 'assets/icons',
      sessionId: 'sess-mkdir',
    });
  });

  it('conversation helpers list/create/messages', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: [{ id: 'c1', projectId: 'p1', title: 't' }] }),
    );
    await client.listConversations('p1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/projects\/p1\/conversations$/);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'c2', projectId: 'p1', title: 'Project chat' } }),
    );
    await client.createConversation('p1', 'Project chat');
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toEqual({
      title: 'Project chat',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listMessages('p1', 'c1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(
      /\/projects\/p1\/conversations\/c1\/messages$/,
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { id: 'm1', conversationId: 'c1', role: 'user', content: 'hi' },
      }),
    );
    await client.addMessage('p1', 'c1', { role: 'user', content: 'hi' });
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toEqual({
      role: 'user',
      content: 'hi',
    });

    await expect(client.addMessage('p1', 'c1', { content: '' })).resolves.toMatchObject({
      ok: false,
    });
  });

  it('restoreRevision sends sessionId body + header', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { path: 'a.html', hash: 'restored' } }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    await client.restoreRevision('p1', 'rev-1', { sessionId: 'sess-rest' });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/revisions/rev-1/restore');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-neos-session-id']).toBe('sess-rest');
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: 'sess-rest' });
  });

  it('rejects control chars in sessionId (no header/body session)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { path: 'a.html', hash: 'h3', bytes: 1, created: false },
      }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    await client.writeFile('p1', 'a.html', 'y', { sessionId: 'bad\nsess' });
    const init = fetchMock.mock.calls[0]![1] as {
      headers: Record<string, string>;
      body: string;
    };
    expect(init.headers['x-neos-session-id']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ content: 'y', source: 'user' });
  });

  it('streamRunEvents hits events/stream URL, parses event, and aborts', async () => {
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

    const client = new WebApiClient('http://engine.test', 'tok');
    const events: Array<{ type: string; id?: string; data?: unknown }> = [];
    let done = false;
    const stop = client.streamRunEvents(
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
        Authorization: 'Bearer tok',
      }),
      signal: expect.any(AbortSignal),
    });
    expect(events[0]).toMatchObject({
      type: 'run.stdout',
      id: 'ev1',
      data: { chunk: 'hello' },
    });
    stop();
  });

  it('streamRunEvents onError for invalid run id without fetch', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    const prev = fetchMock.mock.calls.length;
    let err: unknown;
    const stop = client.streamRunEvents(
      `run${'\n'}x`,
      () => {},
      { onError: (e) => { err = e; } },
    );
    await vi.waitFor(() => {
      expect(err).toBeInstanceOf(Error);
    });
    expect(fetchMock.mock.calls.length).toBe(prev);
    stop();
  });
});

describe('WebApiClient preview comments + project zip (v0.9 M2)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listPreviewComments with path query', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: [
          {
            id: 'c1',
            projectId: 'p1',
            filePath: 'index.html',
            selector: 'h1',
            body: 'hi',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    const res = await client.listPreviewComments('p1', 'index.html');
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.id).toBe('c1');
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      '/api/projects/p1/preview-comments?path=index.html',
    );
  });

  it('listPreviewComments fails closed when schema invalid', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: [{ id: 'c1', body: 'missing required fields' }],
      }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    const res = await client.listPreviewComments('p1');
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('listRevisions validates contentHash domain', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: [
          {
            id: 'rev1',
            path: 'a.html',
            contentHash: 'deadbeef',
            source: 'user',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    const res = await client.listRevisions('p1', 'a.html');
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.contentHash).toBe('deadbeef');
  });

  it('createPreviewComment posts validated body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          ok: true,
          data: {
            id: 'c2',
            projectId: 'p1',
            filePath: 'a.html',
            selector: '#x',
            body: 'note',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        },
        201,
      ),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    const res = await client.createPreviewComment('p1', {
      filePath: 'a.html',
      selector: '#x',
      body: 'note',
    });
    expect(res.ok).toBe(true);
    const init = fetchMock.mock.calls[0]![1] as { method: string; body: string };
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      filePath: 'a.html',
      selector: '#x',
      body: 'note',
    });
  });

  it('createPreviewComment rejects control chars without fetch', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    const res = await client.createPreviewComment('p1', {
      filePath: 'a.html',
      selector: 'h1',
      body: `bad${'\0'}`,
    });
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deletePreviewComment DELETEs by id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new WebApiClient('http://engine.test', 'tok');
    await client.deletePreviewComment('p1', 'c9');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/preview-comments/c9');
    expect(init.method).toBe('DELETE');
  });

  it('exportProjectZip returns blob', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([0x50, 0x4b]), {
        status: 200,
        headers: { 'Content-Type': 'application/zip' },
      }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    const res = await client.exportProjectZip('p1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.blob.size).toBe(2);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/export.zip');
  });

  it('importProjectZip posts application/zip body', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { project: { id: 'p-new', name: 'Imported' }, filesImported: 3 },
      }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    const file = new File([new Uint8Array([1, 2, 3])], 'proj.zip', {
      type: 'application/zip',
    });
    const res = await client.importProjectZip(file);
    expect(res.ok).toBe(true);
    expect(res.data?.project.id).toBe('p-new');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/projects/import.zip');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/zip');
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('importProjectZip rejects oversized zip without fetch', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    const big = new Blob([new Uint8Array(50 * 1024 * 1024 + 1)]);
    const res = await client.importProjectZip(big);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/50 MiB/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('WebApiClient media (v0.23)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listMediaFiles GETs /api/media/files with clamped limit', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: [
          {
            filename: 'a.png',
            size: 10,
            kind: 'image',
            mimeType: 'image/png',
            createdAt: '2026-01-01T00:00:00.000Z',
            urlPath: '/api/media/file/a.png',
          },
        ],
      }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    const res = await client.listMediaFiles(50);
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.filename).toBe('a.png');
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://engine.test/api/media/files?limit=50',
    );
  });

  it('listMediaProviders GETs /api/media/providers', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: [{ id: 'openai', label: 'OpenAI', surfaces: ['image'], configured: true }],
      }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    const res = await client.listMediaProviders();
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.id).toBe('openai');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://engine.test/api/media/providers');
  });

  it('generateMedia posts unified body and validates prompt/text', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');

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
    expect(fetchMock).not.toHaveBeenCalled();

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

  it('getMediaJob GETs job id and rejects invalid id', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.getMediaJob(`bad${'\n'}id`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid job id',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { id: 'job1', surface: 'video', provider: 'x', status: 'running' },
      }),
    );
    const job = await client.getMediaJob('job1');
    expect(job.ok).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/media\/jobs\/job1/);
  });

  it('mediaFileUrl and fetchMediaBlob use safe filename segment', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    expect(client.mediaFileUrl('photo.png')).toBe('http://engine.test/api/media/file/photo.png');
    expect(client.mediaFileUrl('../escape.png')).toBeNull();
    expect(client.mediaFileUrl(`bad${'\0'}.png`)).toBeNull();

    await expect(client.fetchMediaBlob('../x.png')).rejects.toThrow(/Invalid media filename/);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    );
    const blob = await client.fetchMediaBlob('photo.png');
    expect(blob.size).toBe(3);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://engine.test/api/media/file/photo.png',
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      headers: { Authorization: 'Bearer tok' },
    });
  });
});

describe('WebApiClient workflows (v0.24)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('listWorkflows GETs /api/workflow', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: [{ id: 'w1', name: 'A', domain: 'general', updatedAt: '2026-01-01T00:00:00.000Z' }],
      }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    const res = await client.listWorkflows();
    expect(res.ok).toBe(true);
    expect(res.data?.[0]?.id).toBe('w1');
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://engine.test/api/workflow');
  });

  it('getWorkflow GETs id and rejects control-char / blank id', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.getWorkflow('')).rejects.toMatchObject({
      message: expect.stringMatching(/Invalid workflow id/i),
    });
    await expect(client.getWorkflow(`bad${'\n'}id`)).rejects.toMatchObject({
      message: expect.stringMatching(/Invalid workflow id/i),
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
          id: 'w1',
          name: 'N',
          domain: 'coding',
          nodes: [],
          edges: [],
        },
      }),
    );
    const res = await client.getWorkflow('w1');
    expect(res.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://engine.test/api/workflow/w1');
  });

  it('createWorkflow posts name/domain/nodes and rejects invalid name', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.createWorkflow({ name: '' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid name',
    });
    await expect(
      client.createWorkflow({ name: `bad${'\0'}x` }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid name' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'w-new', name: 'Landing', domain: 'general' } }, 201),
    );
    const res = await client.createWorkflow({
      name: '  Landing  ',
      domain: 'general',
      nodes: [{ id: 't1', type: 'trigger', label: 'Trigger', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    });
    expect(res.ok).toBe(true);
    expect(res.data?.id).toBe('w-new');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/workflow$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({
      name: 'Landing',
      primaryDomain: 'general',
      domain: 'general',
    });
  });

  it('updateWorkflow puts patch and validates id/name', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.updateWorkflow('', { name: 'x' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    await expect(
      client.updateWorkflow('w1', { name: `bad${'\n'}name` }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid name' });
    await expect(client.updateWorkflow('w1', {})).resolves.toMatchObject({
      ok: false,
      error: 'No fields to update',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'w1', name: 'Renamed', domain: 'general' } }),
    );
    const res = await client.updateWorkflow('w1', {
      name: '  Renamed  ',
      nodes: [],
      edges: [],
    });
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/workflow\/w1$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Renamed',
      nodes: [],
      edges: [],
    });
  });

  it('deleteWorkflow DELETEs and rejects invalid id', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.deleteWorkflow(`bad${'\0'}id`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const res = await client.deleteWorkflow('w1');
    expect(res.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/workflow\/w1$/);
    expect(init.method).toBe('DELETE');
  });

  it('listWorkflowRuns GETs runs with clamped limit', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.listWorkflowRuns(`bad${'\n'}x`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: [{ id: 'r1', workflowId: 'w1', status: 'completed' }],
      }),
    );
    const res = await client.listWorkflowRuns('w1', 10, 5);
    expect(res.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'http://engine.test/api/workflow/w1/runs?limit=10&offset=5',
    );
  });

  it('runWorkflow posts SSE run and parses data lines; abort cancels', async () => {
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

    const client = new WebApiClient('http://engine.test', 'tok');
    const events: Array<{ type: string }> = [];
    const stop = client.runWorkflow('w1', (e) => events.push(e), { foo: 1 });

    await vi.waitFor(() => {
      expect(events.length).toBeGreaterThanOrEqual(2);
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://engine.test/api/workflow/w1/run');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Accept: 'text/event-stream',
        Authorization: 'Bearer tok',
      }),
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({ inputs: { foo: 1 } });
    expect(events[0]).toMatchObject({ type: 'run.started', runId: 'r1' });
    stop();
  });

  it('runWorkflow emits failed for invalid id without fetch', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    const prev = fetchMock.mock.calls.length;
    const events: Array<{ type: string; error?: string }> = [];
    const stop = client.runWorkflow(`wf${'\0'}x`, (e) => events.push(e));
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'run.failed')).toBe(true);
    });
    expect(fetchMock.mock.calls.length).toBe(prev);
    expect(events[0]?.error).toMatch(/Invalid workflow id/i);
    stop();
  });

  it('listSessions and createSession hit /api/session', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listSessions('default');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/session\?workspaceId=default$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 's1' } }));
    const created = await client.createSession({
      workspaceId: 'default',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
    });
    expect(created.ok).toBe(true);
    expect(fetchMock.mock.calls.at(-1)![1].method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toMatchObject({
      workspaceId: 'default',
      provider: 'anthropic',
    });
    await expect(client.createSession({ workspaceId: '' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workspace id',
    });
  });

  it('memory CRUD rejects invalid payloads', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(
      client.createMemory({ name: '', type: 'user', content: 'x' }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid name' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'm1' } }));
    await client.createMemory({ name: 'N', type: 'user', content: 'hello' });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/memory$/);
    await expect(client.deleteWorkspace('default')).resolves.toMatchObject({
      ok: false,
      error: 'Cannot delete default workspace',
    });
  });

  it('listWorkers / listDomainPacks / listPlugins / catalog', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listWorkers('coding');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/workers\?domain=coding$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listDomainPacks();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/domain-packs$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listPlugins();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/plugins$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { entries: [] } }));
    await client.fetchMarketplaceCatalog('https://example.com/c.json');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('/api/marketplace/catalog?url=');

    await expect(client.installMarketplaceEntry({})).resolves.toMatchObject({
      ok: false,
      error: 'id or url required',
    });
  });

  it('skills / blocks / templates / design systems / routines / deploy', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listSkills();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/skills$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listBlocks('coding');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/blocks\?domain=coding$/);

    await expect(client.createBlock({ id: '', name: 'x' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid id',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listTemplates();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/templates$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listDesignSystems();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/design-systems$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listRoutines();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/routines$/);

    await expect(client.createRoutine({ name: '', workflowId: 'w1', schedule: '* * * * *' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid name',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listDeployments();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/deploy$/);

    await expect(
      client.createDeployment({ provider: 'vercel', content: '' }),
    ).resolves.toMatchObject({ ok: false, error: 'content required' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { url: null } }));
    await client.getMarketplaceCatalogUrl();
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/marketplace\/catalog-url$/);
  });

  it('listWorkflowRuns clamps limit/offset and rejects bad ids', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.listWorkflowRuns(`wf${'\0'}x`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid workflow id',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: [] }));
    await client.listWorkflowRuns('w1', 999, -4);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(
      'http://engine.test/api/workflow/w1/runs?limit=100&offset=0',
    );
  });

  it('createBlock / toggleSkill / createRoutine / deployPreflight validate', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.createBlock({ id: 'my_block', name: '' })).resolves.toMatchObject({
      ok: false,
      error: 'Invalid name',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'my_block' } }));
    await client.createBlock({
      id: 'my_block',
      name: 'Mine',
      implementationType: 'prompt',
      promptTemplate: 'Do X',
    });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toMatchObject({
      id: 'my_block',
      name: 'Mine',
      implementationType: 'prompt',
    });

    await expect(client.toggleSkill('', false)).resolves.toMatchObject({ ok: false, error: 'Invalid skill id' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await client.toggleSkill('code-review', false);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/skills\/code-review\/toggle$/);

    await expect(
      client.createRoutine({ name: 'Night', workflowId: '', schedule: '0 9 * * *' }),
    ).resolves.toMatchObject({ ok: false, error: 'Invalid workflow id' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'r1' } }));
    await client.createRoutine({ name: 'Night', workflowId: 'w1', schedule: '0 9 * * *' });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toMatchObject({
      name: 'Night',
      workflowId: 'w1',
      schedule: '0 9 * * *',
    });

    await expect(client.deployPreflight('aws' as 'vercel')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid provider',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { ready: true } }));
    const pf = await client.deployPreflight('vercel', 'neos-deploy');
    expect(pf.ok).toBe(true);
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/deploy\/preflight$/);

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { id: 'd1' } }));
    await client.createDeployment({
      provider: 'vercel',
      content: '<html></html>',
      projectName: 'site',
    });
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toMatchObject({
      provider: 'vercel',
      projectName: 'site',
    });
  });

  it('design system content and pack zip reject bad input', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.saveDesignSystemContent('', '# x')).resolves.toMatchObject({
      ok: false,
      error: 'Invalid design system id',
    });
    await expect(client.saveDesignSystemContent('ds1', `ok${'\0'}`)).resolves.toMatchObject({
      ok: false,
      error: 'Invalid content',
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, data: { content: '# D' } }));
    await client.getDesignSystemContent('ds1');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toMatch(/\/api\/design-systems\/ds1\/content$/);

    await expect(client.installDomainPackFromZip(new Blob())).resolves.toMatchObject({
      ok: false,
      error: 'Empty zip',
    });
  });
});

describe('WebApiClient skills catalog', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searchSkillCatalog GETs q and optional owner', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { query: 'find', skills: [] } }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    const res = await client.searchSkillCatalog('find', { owner: 'vercel-labs' });
    expect(res.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/skills/catalog/search');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('q=find');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('owner=vercel-labs');
  });

  it('searchSkillCatalog rejects short query and invalid owner without fetch', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(client.searchSkillCatalog('a')).resolves.toMatchObject({
      ok: false,
      error: 'query_too_short',
    });
    await expect(
      client.searchSkillCatalog('find', { owner: 'Not A Valid Owner' }),
    ).resolves.toMatchObject({ ok: false, error: 'invalid_id' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('previewRemoteSkill GETs id', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'vercel-labs/skills/find-skills', skillMd: '#' } }),
    );
    const client = new WebApiClient('http://engine.test', 'tok');
    const res = await client.previewRemoteSkill({ id: 'vercel-labs/skills/find-skills' });
    expect(res.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/skills/catalog/preview');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('vercel-labs');
  });

  it('installRemoteSkill requires confirm:true and POSTs it', async () => {
    const client = new WebApiClient('http://engine.test', 'tok');
    await expect(
      client.installRemoteSkill({ id: 'vercel-labs/skills/find-skills' } as { id: string; confirm: true }),
    ).resolves.toMatchObject({ ok: false, error: 'confirm_required' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, data: { id: 'inst-1', source: 'remote' } }),
    );
    const res = await client.installRemoteSkill({
      id: 'vercel-labs/skills/find-skills',
      confirm: true,
    });
    expect(res.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/api\/skills\/install$/);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({
      id: 'vercel-labs/skills/find-skills',
      confirm: true,
    });
  });
});
