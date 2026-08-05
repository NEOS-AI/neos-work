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
