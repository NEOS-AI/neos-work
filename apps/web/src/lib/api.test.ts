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
