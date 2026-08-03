/**
 * Minimal browser API client for NEOS daemon.
 */

export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class WebApiClient {
  constructor(
    public serverUrl: string,
    public token: string,
  ) {}

  private headers(): HeadersInit {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  private url(path: string): string {
    const base = this.serverUrl.replace(/\/+$/, '');
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<ApiEnvelope<T>> {
    const res = await fetch(this.url(path), {
      method,
      headers: {
        ...this.headers(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let envelope: ApiEnvelope<T>;
    try {
      const json: unknown = await res.json();
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        envelope = json as ApiEnvelope<T>;
      } else {
        envelope = { ok: res.ok, data: json as T };
      }
    } catch {
      // health returns bare object
      envelope = { ok: res.ok };
    }
    if (!res.ok) {
      const msg =
        typeof envelope.error === 'string' && envelope.error
          ? envelope.error
          : `HTTP ${res.status}`;
      throw new ApiError(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 300), res.status);
    }
    return envelope;
  }

  async health(): Promise<{ status: string; version?: string; uptime?: number }> {
    const res = await fetch(this.url('/api/health'), { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`, res.status);
    return (await res.json()) as { status: string; version?: string; uptime?: number };
  }

  listProjects(): Promise<ApiEnvelope<Array<{ id: string; name: string; baseDir?: string; entryFile?: string | null }>>> {
    return this.request('GET', '/api/projects');
  }

  getProject(id: string): Promise<ApiEnvelope<{ id: string; name: string; baseDir?: string; entryFile?: string | null }>> {
    return this.request('GET', `/api/projects/${encodeURIComponent(id)}`);
  }

  listFiles(projectId: string): Promise<ApiEnvelope<Array<{ path: string; type?: string }>>> {
    return this.request('GET', `/api/projects/${encodeURIComponent(projectId)}/files`);
  }

  readFile(projectId: string, filePath: string): Promise<ApiEnvelope<{ content?: string; path?: string }>> {
    const segs = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return this.request('GET', `/api/projects/${encodeURIComponent(projectId)}/files/${segs}`);
  }

  writeFile(projectId: string, filePath: string, content: string): Promise<ApiEnvelope<unknown>> {
    const segs = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return this.request('PUT', `/api/projects/${encodeURIComponent(projectId)}/files/${segs}`, {
      content,
      source: 'user',
    });
  }

  createRun(input: {
    projectId: string;
    prompt: string;
    agentId?: string;
    editContext?: unknown;
  }): Promise<ApiEnvelope<{ id?: string; status?: string }>> {
    return this.request('POST', '/api/runs', input);
  }

  getRun(runId: string): Promise<ApiEnvelope<{ id?: string; status?: string; projectId?: string }>> {
    return this.request('GET', `/api/runs/${encodeURIComponent(runId)}`);
  }

  /** GET /api/mcp/install-info — snippets for neos mcp serve clients. */
  getMcpInstallInfo(query?: {
    projectId?: string;
    includeToken?: boolean;
  }): Promise<
    ApiEnvelope<{
      serverName?: string;
      shellSnippet?: string;
      codexAddCommand?: string;
      codexRemoveCommand?: string;
      claudeDesktop?: unknown;
      tools?: Array<{ name: string; description?: string }>;
      version?: string;
      notes?: string[];
    }>
  > {
    const qs = new URLSearchParams();
    if (query?.projectId && !/[\0\r\n]/.test(query.projectId)) {
      const p = query.projectId.trim().slice(0, 100);
      if (p) qs.set('projectId', p);
    }
    if (query?.includeToken === false) qs.set('includeToken', '0');
    const q = qs.toString();
    return this.request('GET', `/api/mcp/install-info${q ? `?${q}` : ''}`);
  }

  /**
   * Subscribe to project file SSE (`file.changed` / `file.created` / `file.deleted`).
   * Uses fetch + Bearer (EventSource cannot set Authorization).
   * Returns an abort function.
   */
  /**
   * Project collab presence SSE (v0.6.0 + v0.7 M2 selection).
   * Events: ready | presence.sync | presence.join | presence.leave | lock.* | selection.changed
   */
  streamProjectCollab(
    projectId: string,
    onEvent: (event: {
      type: string;
      projectId?: string;
      sessionId?: string;
      peers?: Array<{ sessionId: string; displayName: string; colorHint?: number; joinedAt?: string }>;
      peer?: { sessionId: string; displayName: string; colorHint?: number; joinedAt?: string };
      self?: { sessionId: string; displayName: string; colorHint?: number; joinedAt?: string };
      locks?: Array<{ path: string; sessionId: string; displayName: string; acquiredAt?: string }>;
      lock?: { path: string; sessionId: string; displayName: string; acquiredAt?: string };
      path?: string;
      selections?: Array<{
        sessionId: string;
        displayName?: string;
        colorHint?: number;
        path: string | null;
        selector: string | null;
        layerId?: string | null;
        updatedAt?: string;
      }>;
      selection?: {
        sessionId: string;
        displayName?: string;
        colorHint?: number;
        path: string | null;
        selector: string | null;
        layerId?: string | null;
        updatedAt?: string;
      };
    }) => void,
    opts?: { displayName?: string },
  ): () => void {
    const controller = new AbortController();
    const id = encodeURIComponent(projectId);
    const qs =
      opts?.displayName && !/[\0\r\n]/.test(opts.displayName)
        ? `?name=${encodeURIComponent(opts.displayName.trim().slice(0, 48))}`
        : '';
    void (async () => {
      try {
        const res = await fetch(this.url(`/api/projects/${id}/collab/stream${qs}`), {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let eventName = 'message';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('event:')) {
              const name = line.slice(6).trim();
              eventName = name && !/[\0\r\n]/.test(name) ? name : 'message';
            } else if (line.startsWith('data:')) {
              const raw = line.slice(5).trim();
              if (!raw || /[\0]/.test(raw)) continue;
              try {
                const data = JSON.parse(raw) as Record<string, unknown>;
                onEvent({
                  type: eventName,
                  projectId: typeof data.projectId === 'string' ? data.projectId : undefined,
                  sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
                  peers: Array.isArray(data.peers)
                    ? (data.peers as Array<{
                        sessionId: string;
                        displayName: string;
                        colorHint?: number;
                        joinedAt?: string;
                      }>)
                    : undefined,
                  peer:
                    data.peer && typeof data.peer === 'object'
                      ? (data.peer as {
                          sessionId: string;
                          displayName: string;
                          colorHint?: number;
                          joinedAt?: string;
                        })
                      : undefined,
                  self:
                    data.self && typeof data.self === 'object'
                      ? (data.self as {
                          sessionId: string;
                          displayName: string;
                          colorHint?: number;
                          joinedAt?: string;
                        })
                      : undefined,
                  locks: Array.isArray(data.locks)
                    ? (data.locks as Array<{
                        path: string;
                        sessionId: string;
                        displayName: string;
                        acquiredAt?: string;
                      }>)
                    : undefined,
                  lock:
                    data.lock && typeof data.lock === 'object'
                      ? (data.lock as {
                          path: string;
                          sessionId: string;
                          displayName: string;
                          acquiredAt?: string;
                        })
                      : undefined,
                  path: typeof data.path === 'string' ? data.path : undefined,
                  selections: Array.isArray(data.selections)
                    ? (data.selections as Array<{
                        sessionId: string;
                        displayName?: string;
                        colorHint?: number;
                        path: string | null;
                        selector: string | null;
                        layerId?: string | null;
                        updatedAt?: string;
                      }>)
                    : undefined,
                  selection:
                    data.selection && typeof data.selection === 'object'
                      ? (data.selection as {
                          sessionId: string;
                          displayName?: string;
                          colorHint?: number;
                          path: string | null;
                          selector: string | null;
                          layerId?: string | null;
                          updatedAt?: string;
                        })
                      : undefined,
                });
              } catch {
                // skip
              }
              eventName = 'message';
            } else if (line === '') {
              eventName = 'message';
            }
          }
        }
      } catch {
        // abort
      }
    })();
    return () => controller.abort();
  }

  collabLock(
    projectId: string,
    body: { sessionId: string; path: string; action: 'acquire' | 'release' },
  ): Promise<ApiEnvelope<{ lock?: unknown; released?: boolean; holder?: unknown }>> {
    return this.request('POST', `/api/projects/${encodeURIComponent(projectId)}/collab/locks`, body);
  }

  /** Publish editing selection for peer awareness (v0.7 M2). */
  collabSelection(
    projectId: string,
    body: {
      sessionId: string;
      path?: string | null;
      selector?: string | null;
      layerId?: string | null;
    },
  ): Promise<ApiEnvelope<{ selection?: unknown }>> {
    return this.request(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/collab/selection`,
      body,
    );
  }

  streamProjectFileEvents(
    projectId: string,
    onEvent: (event: {
      type: string;
      projectId?: string;
      path?: string;
      source?: string;
      hash?: string;
    }) => void,
  ): () => void {
    const controller = new AbortController();
    const id = encodeURIComponent(projectId);
    void (async () => {
      try {
        const res = await fetch(this.url(`/api/projects/${id}/events/stream`), {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let eventName = 'message';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('event:')) {
              const name = line.slice(6).trim();
              eventName = name && !/[\0\r\n]/.test(name) ? name : 'message';
            } else if (line.startsWith('data:')) {
              const raw = line.slice(5).trim();
              if (!raw || /[\0]/.test(raw)) continue;
              try {
                const data = JSON.parse(raw) as Record<string, unknown>;
                onEvent({
                  type: eventName,
                  projectId: typeof data.projectId === 'string' ? data.projectId : undefined,
                  path: typeof data.path === 'string' ? data.path : undefined,
                  source: typeof data.source === 'string' ? data.source : undefined,
                  hash: typeof data.hash === 'string' ? data.hash : undefined,
                });
              } catch {
                // skip malformed
              }
              eventName = 'message';
            } else if (line === '') {
              eventName = 'message';
            }
          }
        }
      } catch {
        // abort / network — silent
      }
    })();
    return () => controller.abort();
  }
}
