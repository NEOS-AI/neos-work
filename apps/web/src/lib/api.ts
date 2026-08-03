/**
 * Minimal browser API client for NEOS daemon.
 */

import type {
  FileRevision,
  ProjectFileContent,
  ProjectFileEntry,
  ProjectFileEventPayload,
  ProjectFileWriteResult,
} from '@neos-work/shared';

export interface ApiEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export { normalizeProjectRelPath } from '@neos-work/shared';

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

  /**
   * Parse JSON envelope. Never throws on HTTP 4xx/5xx — returns `{ ok: false, error, data }`.
   * Network/abort failures still reject. Used by collab APIs that need 409 `data.holder`.
   */
  private async requestEnvelope<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiEnvelope<T>> {
    const res = await fetch(this.url(path), {
      method,
      headers: {
        ...this.headers(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    try {
      const json: unknown = await res.json();
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        const envelope = json as ApiEnvelope<T>;
        // Ensure ok reflects HTTP when server omitted it
        if (envelope.ok === undefined) {
          return { ...envelope, ok: res.ok };
        }
        return envelope;
      }
      return { ok: res.ok, data: json as T };
    } catch {
      return {
        ok: res.ok,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    }
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
      throw new ApiError(msg.replace(/[\0\r\n]+/g, ' ').slice(0, 300), res.status, envelope.data);
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

  listFiles(projectId: string): Promise<ApiEnvelope<ProjectFileEntry[]>> {
    return this.request('GET', `/api/projects/${encodeURIComponent(projectId)}/files`);
  }

  readFile(
    projectId: string,
    filePath: string,
  ): Promise<ApiEnvelope<ProjectFileContent>> {
    const segs = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return this.request('GET', `/api/projects/${encodeURIComponent(projectId)}/files/${segs}`);
  }

  /**
   * Write project file. Returns full envelope on HTTP errors (e.g. 423 hard lock
   * with `data.holder`) instead of throwing — callers check `res.ok`.
   */
  writeFile(
    projectId: string,
    filePath: string,
    content: string,
  ): Promise<ApiEnvelope<ProjectFileWriteResult & { contentHash?: string; holder?: unknown }>> {
    const segs = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return this.requestEnvelope('PUT', `/api/projects/${encodeURIComponent(projectId)}/files/${segs}`, {
      content,
      source: 'user',
    });
  }

  /**
   * DELETE /api/projects/:id/files/*
   * Returns full envelope on HTTP errors (does not throw on 4xx/5xx).
   */
  deleteFile(
    projectId: string,
    filePath: string,
  ): Promise<ApiEnvelope<{ path?: string; deleted?: boolean; holder?: unknown }>> {
    const segs = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return this.requestEnvelope(
      'DELETE',
      `/api/projects/${encodeURIComponent(projectId)}/files/${segs}`,
    );
  }

  /**
   * GET /api/projects/:id/revisions?path= — list file revisions (no content).
   * Optional `filePath` is appended as `?path=` when free of control characters.
   */
  listRevisions(
    projectId: string,
    filePath?: string,
  ): Promise<
    ApiEnvelope<
      Array<
        Pick<FileRevision, 'id' | 'path' | 'contentHash' | 'source' | 'createdAt'> & {
          projectId?: string;
        }
      >
    >
  > {
    let qs = '';
    if (filePath != null && filePath !== '') {
      if (typeof filePath === 'string' && !/[\0\r\n]/.test(filePath)) {
        const p = filePath.trim();
        if (p) qs = `?path=${encodeURIComponent(p)}`;
      }
    }
    return this.request(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}/revisions${qs}`,
    );
  }

  /** GET /api/projects/:id/revisions/:revisionId — full revision with content. */
  getRevision(
    projectId: string,
    revisionId: string,
  ): Promise<
    ApiEnvelope<
      Pick<FileRevision, 'id' | 'path' | 'contentHash' | 'source' | 'createdAt'> & {
        projectId?: string;
        content?: string;
      }
    >
  > {
    return this.request(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}`,
    );
  }

  /**
   * POST /api/projects/:id/revisions/:revisionId/restore
   * Returns full envelope on HTTP errors (does not throw on 4xx/5xx).
   */
  restoreRevision(
    projectId: string,
    revisionId: string,
  ): Promise<ApiEnvelope<{ path?: string; hash?: string }>> {
    return this.requestEnvelope(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
    );
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
   * Events: ready | presence.sync | presence.join | presence.leave | presence.heartbeat | lock.* | selection.changed
   */
  streamProjectCollab(
    projectId: string,
    onEvent: (event: {
      type: string;
      projectId?: string;
      sessionId?: string;
      /** Top-level (e.g. presence.heartbeat). */
      displayName?: string;
      colorHint?: number;
      /** presence.leave reason */
      reason?: 'leave' | 'idle' | 'evicted' | string;
      peers?: Array<{
        sessionId: string;
        displayName: string;
        colorHint?: number;
        joinedAt?: string;
        lastSeen?: string;
      }>;
      peer?: {
        sessionId: string;
        displayName: string;
        colorHint?: number;
        joinedAt?: string;
        lastSeen?: string;
      };
      self?: {
        sessionId: string;
        displayName: string;
        colorHint?: number;
        joinedAt?: string;
        lastSeen?: string;
      };
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
        selectors?: string[];
        layerIds?: string[];
        updatedAt?: string;
      }>;
      selection?: {
        sessionId: string;
        displayName?: string;
        colorHint?: number;
        path: string | null;
        selector: string | null;
        layerId?: string | null;
        selectors?: string[];
        layerIds?: string[];
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
                  displayName:
                    typeof data.displayName === 'string' ? data.displayName : undefined,
                  colorHint:
                    typeof data.colorHint === 'number' && Number.isFinite(data.colorHint)
                      ? data.colorHint
                      : undefined,
                  reason:
                    typeof data.reason === 'string' && !/[\0\r\n]/.test(data.reason)
                      ? data.reason
                      : undefined,
                  peers: Array.isArray(data.peers)
                    ? (data.peers as Array<{
                        sessionId: string;
                        displayName: string;
                        colorHint?: number;
                        joinedAt?: string;
                        lastSeen?: string;
                      }>)
                    : undefined,
                  peer:
                    data.peer && typeof data.peer === 'object'
                      ? (data.peer as {
                          sessionId: string;
                          displayName: string;
                          colorHint?: number;
                          joinedAt?: string;
                          lastSeen?: string;
                        })
                      : undefined,
                  self:
                    data.self && typeof data.self === 'object'
                      ? (data.self as {
                          sessionId: string;
                          displayName: string;
                          colorHint?: number;
                          joinedAt?: string;
                          lastSeen?: string;
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
                        selectors?: string[];
                        layerIds?: string[];
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
                          selectors?: string[];
                          layerIds?: string[];
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

  /**
   * Advisory file lock. Returns full envelope on 409 (includes `data.holder`)
   * instead of throwing — matches desktop `readApiResponse` behavior.
   */
  collabLock(
    projectId: string,
    body: { sessionId: string; path: string; action: 'acquire' | 'release' },
  ): Promise<ApiEnvelope<{ lock?: unknown; released?: boolean; holder?: unknown }>> {
    return this.requestEnvelope(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/collab/locks`,
      body,
    );
  }

  /** Publish editing selection for peer awareness (v0.7 M2 + v0.8 M3 multi). */
  collabSelection(
    projectId: string,
    body: {
      sessionId: string;
      path?: string | null;
      selector?: string | null;
      layerId?: string | null;
      /** Multi-select ordered (last = primary). */
      selectors?: string[] | null;
      layerIds?: string[] | null;
    },
  ): Promise<ApiEnvelope<{ selection?: unknown }>> {
    return this.requestEnvelope(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/collab/selection`,
      body,
    );
  }

  /** Snapshot of current collab peers (REST helper; multi-replica resync). */
  getCollabPeers(
    projectId: string,
  ): Promise<
    ApiEnvelope<{
      peers?: Array<{
        sessionId: string;
        displayName: string;
        colorHint?: number;
        joinedAt?: string;
        lastSeen?: string;
      }>;
    }>
  > {
    return this.requestEnvelope(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}/collab/peers`,
    );
  }

  /** Heartbeat to keep presence alive if SSE stalls. */
  postCollabHeartbeat(
    projectId: string,
    body: { sessionId: string },
  ): Promise<ApiEnvelope<{ touched?: boolean }>> {
    return this.requestEnvelope(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/collab/heartbeat`,
      body,
    );
  }

  streamProjectFileEvents(
    projectId: string,
    onEvent: (event: ProjectFileEventPayload & { type: string }) => void,
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
