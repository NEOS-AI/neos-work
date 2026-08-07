/**
 * Minimal browser API client for NEOS daemon.
 *
 * Envelope policy:
 * - **Mutating** methods (POST/PUT/PATCH/DELETE) use `requestEnvelope` — never throw
 *   on HTTP status; return `{ ok, data?, error? }`. Callers check `res.ok`.
 * - **GET/read** methods may keep throwing `ApiError` via `request()` for simpler load paths.
 * - Network/abort failures still reject the promise (both helpers).
 */

import {
  parseCollabLockConflict,
  parseFileRevisionDetailResponse,
  parseFileRevisionListResponse,
  parsePreviewCommentDetailResponse,
  parsePreviewCommentListResponse,
  parseProjectFileWriteResponse,
  type FileRevision,
  type PreviewComment,
  type ProjectFileContent,
  type ProjectFileEntry,
  type ProjectFileEventPayload,
  type ProjectFileWriteResult,
  type ProjectRunEvent,
  type ProjectRunSummary,
} from '@neos-work/shared';

export type { PreviewComment };

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
   * Mutating-request helper: never throws on HTTP 4xx/5xx.
   * Returns `{ ok: false, error?, data? }` so callers can surface conflicts (e.g. 409 holder).
   * Network/abort failures still reject.
   * @see request for GET/read paths that throw ApiError on non-OK HTTP
   */
  private async requestEnvelope<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { headers?: Record<string, string> },
  ): Promise<ApiEnvelope<T>> {
    const res = await fetch(this.url(path), {
      method,
      headers: {
        ...this.headers(),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...opts?.headers,
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

  /**
   * Sanitize collab presence session id for hard-enforce (body + x-neos-session-id).
   * Rejects control chars; returns '' when missing/invalid.
   */
  private collabSessionId(raw: unknown): string {
    if (raw == null || typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
    return raw.trim();
  }

  /** Headers for NEOS_SHARED_EDIT hard enforce (mirrors desktop EngineClient). */
  private collabSessionHeaders(sessionId: string): Record<string, string> | undefined {
    if (!sessionId) return undefined;
    return { 'x-neos-session-id': sessionId };
  }

  /**
   * Read-request helper: throws `ApiError` on non-OK HTTP status.
   * Prefer for GET/load paths where try/catch is enough. Mutates should use
   * `requestEnvelope` instead so callers can check `res.ok` without try/catch.
   * Network/abort failures still reject.
   * @see requestEnvelope for POST/PUT/PATCH/DELETE
   */
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

  /**
   * POST /api/projects — create a design project (daemon allocates baseDir when omitted).
   * Returns full envelope on HTTP errors (does not throw on 4xx/5xx).
   */
  createProject(input: {
    name: string;
    entryFile?: string | null;
  }): Promise<
    ApiEnvelope<{ id: string; name: string; baseDir?: string; entryFile?: string | null }>
  > {
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
      return Promise.resolve({ ok: false, error: 'Invalid name' });
    }
    const body: { name: string; entryFile?: string | null } = {
      name: input.name.trim().slice(0, 200),
    };
    if (input.entryFile === null) {
      body.entryFile = null;
    } else if (
      typeof input.entryFile === 'string'
      && !/[\0\r\n]/.test(input.entryFile)
      && input.entryFile.trim()
    ) {
      body.entryFile = input.entryFile.trim();
    }
    return this.requestEnvelope('POST', '/api/projects', body);
  }

  /**
   * PUT /api/projects/:id — rename or patch project fields.
   * Returns full envelope on HTTP errors (does not throw on 4xx/5xx).
   */
  updateProject(
    id: string,
    input: {
      name?: string;
      entryFile?: string | null;
    },
  ): Promise<
    ApiEnvelope<{ id: string; name: string; baseDir?: string; entryFile?: string | null }>
  > {
    if (typeof id !== 'string' || !id.trim() || /[\0\r\n]/.test(id) || id.length > 200) {
      return Promise.resolve({ ok: false, error: 'Invalid project id' });
    }
    const body: { name?: string; entryFile?: string | null } = {};
    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
        return Promise.resolve({ ok: false, error: 'Invalid name' });
      }
      body.name = input.name.trim().slice(0, 200);
    }
    if (input.entryFile === null) {
      body.entryFile = null;
    } else if (
      typeof input.entryFile === 'string'
      && !/[\0\r\n]/.test(input.entryFile)
      && input.entryFile.trim()
    ) {
      body.entryFile = input.entryFile.trim();
    }
    if (Object.keys(body).length === 0) {
      return Promise.resolve({ ok: false, error: 'No fields to update' });
    }
    return this.requestEnvelope(
      'PUT',
      `/api/projects/${encodeURIComponent(id.trim())}`,
      body,
    );
  }

  /**
   * DELETE /api/projects/:id — remove project metadata (files on disk may remain).
   * Returns full envelope on HTTP errors (does not throw on 4xx/5xx).
   */
  deleteProject(id: string): Promise<ApiEnvelope<null>> {
    if (typeof id !== 'string' || !id.trim() || /[\0\r\n]/.test(id) || id.length > 200) {
      return Promise.resolve({ ok: false, error: 'Invalid project id' });
    }
    return this.requestEnvelope(
      'DELETE',
      `/api/projects/${encodeURIComponent(id.trim())}`,
    );
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
   * Success `data` is validated against the shared write schema (`hash` required).
   *
   * Pass `opts.sessionId` (collab presence id) so `NEOS_SHARED_EDIT` hard enforce
   * accepts writes from the current lock holder.
   */
  async writeFile(
    projectId: string,
    filePath: string,
    content: string,
    opts?: { sessionId?: string },
  ): Promise<ApiEnvelope<ProjectFileWriteResult & { holder?: unknown }>> {
    const segs = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const sessionId = this.collabSessionId(opts?.sessionId);
    const body: { content: string; source: string; sessionId?: string } = {
      content,
      source: 'user',
    };
    if (sessionId) body.sessionId = sessionId;
    const envelope = await this.requestEnvelope<
      ProjectFileWriteResult & { holder?: unknown }
    >('PUT', `/api/projects/${encodeURIComponent(projectId)}/files/${segs}`, body, {
      headers: this.collabSessionHeaders(sessionId),
    });
    if (envelope.ok) {
      const checked = parseProjectFileWriteResponse(envelope);
      if (!checked.ok) {
        return { ok: false, error: checked.error };
      }
      return {
        ok: true,
        data: checked.data.data as ProjectFileWriteResult,
      };
    }
    return envelope;
  }

  /**
   * Best-effort parse of a collab lock conflict body (409).
   * Useful when callers have a raw envelope and need `data.holder`.
   */
  static parseLockConflict(body: unknown) {
    return parseCollabLockConflict(body);
  }

  /**
   * DELETE /api/projects/:id/files/*
   * Returns full envelope on HTTP errors (does not throw on 4xx/5xx).
   * Pass `opts.sessionId` for `NEOS_SHARED_EDIT` hard enforce when locked.
   */
  deleteFile(
    projectId: string,
    filePath: string,
    opts?: { sessionId?: string },
  ): Promise<ApiEnvelope<{ path?: string; deleted?: boolean; holder?: unknown }>> {
    const segs = filePath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const sessionId = this.collabSessionId(opts?.sessionId);
    return this.requestEnvelope(
      'DELETE',
      `/api/projects/${encodeURIComponent(projectId)}/files/${segs}`,
      sessionId ? { sessionId } : undefined,
      { headers: this.collabSessionHeaders(sessionId) },
    );
  }

  /**
   * POST /api/projects/:id/mkdir — create a directory under the project root.
   * Pass `opts.sessionId` for `NEOS_SHARED_EDIT` hard enforce when locked.
   */
  mkdir(
    projectId: string,
    dirPath: string,
    opts?: { sessionId?: string },
  ): Promise<ApiEnvelope<{ path?: string; holder?: unknown }>> {
    const sessionId = this.collabSessionId(opts?.sessionId);
    const body: { path: string; sessionId?: string } = { path: dirPath };
    if (sessionId) body.sessionId = sessionId;
    return this.requestEnvelope(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/mkdir`,
      body,
      { headers: this.collabSessionHeaders(sessionId) },
    );
  }

  /**
   * GET /api/projects/:id/revisions?path= — list file revisions (no content).
   * Optional `filePath` is appended as `?path=` when free of control characters.
   * Success data validated via shared Zod (`contentHash` domain).
   */
  async listRevisions(
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
    type RevList = Array<
      Pick<FileRevision, 'id' | 'path' | 'contentHash' | 'source' | 'createdAt'> & {
        projectId?: string;
      }
    >;
    let qs = '';
    if (filePath != null && filePath !== '') {
      if (typeof filePath === 'string' && !/[\0\r\n]/.test(filePath)) {
        const p = filePath.trim();
        if (p) qs = `?path=${encodeURIComponent(p)}`;
      }
    }
    const envelope = await this.request<RevList>(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}/revisions${qs}`,
    );
    if (!envelope.ok) return envelope;
    const checked = parseFileRevisionListResponse(envelope);
    if (!checked.ok) {
      return { ok: false, error: checked.error };
    }
    return {
      ok: true,
      data: (checked.data.data ?? []) as RevList,
    };
  }

  /**
   * GET /api/projects/:id/revisions/:revisionId — full revision with content.
   * Success data validated via shared Zod (`contentHash` domain).
   */
  async getRevision(
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
    type RevDetail = Pick<
      FileRevision,
      'id' | 'path' | 'contentHash' | 'source' | 'createdAt'
    > & {
      projectId?: string;
      content?: string;
    };
    const envelope = await this.request<RevDetail>(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}`,
    );
    if (!envelope.ok) return envelope;
    const checked = parseFileRevisionDetailResponse(envelope);
    if (!checked.ok) {
      return { ok: false, error: checked.error };
    }
    return {
      ok: true,
      data: checked.data.data as RevDetail,
    };
  }

  /**
   * POST /api/projects/:id/revisions/:revisionId/restore
   * Returns full envelope on HTTP errors (does not throw on 4xx/5xx).
   * Pass `opts.sessionId` so `NEOS_SHARED_EDIT` hard enforce accepts lock holders.
   */
  restoreRevision(
    projectId: string,
    revisionId: string,
    opts?: { sessionId?: string },
  ): Promise<ApiEnvelope<{ path?: string; hash?: string; holder?: unknown }>> {
    const sessionId = this.collabSessionId(opts?.sessionId);
    return this.requestEnvelope(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      sessionId ? { sessionId } : undefined,
      { headers: this.collabSessionHeaders(sessionId) },
    );
  }

  // ── Preview comments (v0.9 M2) ────────────────────────────

  async listPreviewComments(
    projectId: string,
    filePath?: string,
  ): Promise<ApiEnvelope<PreviewComment[]>> {
    if (typeof projectId !== 'string' || !projectId.trim() || /[\0\r\n]/.test(projectId)) {
      return { ok: false, error: 'Invalid project id' };
    }
    let qs = '';
    if (filePath != null && filePath !== '') {
      if (typeof filePath !== 'string' || /[\0\r\n]/.test(filePath)) {
        return { ok: false, error: 'Invalid file path' };
      }
      qs = `?path=${encodeURIComponent(filePath.trim())}`;
    }
    const envelope = await this.request<PreviewComment[]>(
      'GET',
      `/api/projects/${encodeURIComponent(projectId.trim())}/preview-comments${qs}`,
    );
    if (!envelope.ok) return envelope;
    const checked = parsePreviewCommentListResponse(envelope);
    if (!checked.ok) {
      return { ok: false, error: checked.error };
    }
    return { ok: true, data: (checked.data.data ?? []) as PreviewComment[] };
  }

  async createPreviewComment(
    projectId: string,
    input: { filePath: string; selector: string; body: string },
  ): Promise<ApiEnvelope<PreviewComment>> {
    if (typeof projectId !== 'string' || !projectId.trim() || /[\0\r\n]/.test(projectId)) {
      return { ok: false, error: 'Invalid project id' };
    }
    if (
      typeof input.filePath !== 'string'
      || typeof input.selector !== 'string'
      || typeof input.body !== 'string'
      || /[\0\r\n]/.test(input.filePath)
      || /[\0\r\n]/.test(input.selector)
      || /\0/.test(input.body)
      || !input.filePath.trim()
      || !input.selector.trim()
      || !input.body.trim()
    ) {
      return { ok: false, error: 'Invalid comment fields' };
    }
    const envelope = await this.requestEnvelope<PreviewComment>(
      'POST',
      `/api/projects/${encodeURIComponent(projectId.trim())}/preview-comments`,
      {
        filePath: input.filePath.trim(),
        selector: input.selector.trim(),
        body: input.body.trim(),
      },
    );
    if (!envelope.ok) return envelope;
    const checked = parsePreviewCommentDetailResponse(envelope);
    if (!checked.ok) {
      return { ok: false, error: checked.error };
    }
    return { ok: true, data: checked.data.data as PreviewComment };
  }

  deletePreviewComment(
    projectId: string,
    commentId: string,
  ): Promise<ApiEnvelope<null>> {
    if (typeof projectId !== 'string' || !projectId.trim() || /[\0\r\n]/.test(projectId)) {
      return Promise.resolve({ ok: false, error: 'Invalid project id' });
    }
    if (typeof commentId !== 'string' || !commentId.trim() || /[\0\r\n]/.test(commentId)) {
      return Promise.resolve({ ok: false, error: 'Invalid comment id' });
    }
    return this.requestEnvelope(
      'DELETE',
      `/api/projects/${encodeURIComponent(projectId.trim())}/preview-comments/${encodeURIComponent(commentId.trim())}`,
    );
  }

  // ── Project zip import/export (v0.9 M2) ───────────────────

  /**
   * Download project as neos-project ZIP.
   * Returns blob on success (not JSON envelope).
   */
  async exportProjectZip(
    projectId: string,
  ): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
    if (typeof projectId !== 'string' || !projectId.trim() || /[\0\r\n]/.test(projectId)) {
      return { ok: false, error: 'Invalid project id' };
    }
    try {
      const res = await fetch(
        this.url(`/api/projects/${encodeURIComponent(projectId.trim())}/export.zip`),
        { headers: this.headers() },
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        const raw = errBody?.error || `HTTP ${res.status}`;
        return { ok: false, error: String(raw).replace(/[\0\r\n]+/g, ' ').slice(0, 300) };
      }
      const blob = await res.blob();
      if (blob.size === 0) return { ok: false, error: 'Empty export' };
      return { ok: true, blob };
    } catch (err) {
      return {
        ok: false,
        error: (err instanceof Error ? err.message : 'Export failed')
          .replace(/[\0\r\n]+/g, ' ')
          .slice(0, 300),
      };
    }
  }

  /**
   * Import neos-project ZIP (raw application/zip body).
   */
  async importProjectZip(
    zip: Blob | ArrayBuffer | File,
  ): Promise<
    ApiEnvelope<{ project: { id: string; name: string }; filesImported?: number }>
  > {
    try {
      const body =
        zip instanceof Blob
          ? zip
          : new Blob([zip], { type: 'application/zip' });
      if (body.size > 50 * 1024 * 1024) {
        return { ok: false, error: 'Zip too large (max 50 MiB)' };
      }
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/zip',
      };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      const res = await fetch(this.url('/api/projects/import.zip'), {
        method: 'POST',
        headers,
        body,
      });
      try {
        const json: unknown = await res.json();
        if (json && typeof json === 'object' && !Array.isArray(json)) {
          const envelope = json as ApiEnvelope<{
            project: { id: string; name: string };
            filesImported?: number;
          }>;
          if (envelope.ok === undefined) {
            return { ...envelope, ok: res.ok };
          }
          return envelope;
        }
        return { ok: res.ok, data: json as { project: { id: string; name: string } } };
      } catch {
        return { ok: false, error: res.ok ? 'Invalid response' : `HTTP ${res.status}` };
      }
    } catch (err) {
      return {
        ok: false,
        error: (err instanceof Error ? err.message : 'Import failed')
          .replace(/[\0\r\n]+/g, ' ')
          .slice(0, 300),
      };
    }
  }

  // ── Project conversations (persisted multi-turn history) ──

  listConversations(
    projectId: string,
  ): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        projectId: string;
        title: string | null;
        createdAt: string;
        updatedAt: string;
      }>
    >
  > {
    return this.request(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}/conversations`,
    );
  }

  createConversation(
    projectId: string,
    title?: string,
  ): Promise<
    ApiEnvelope<{
      id: string;
      projectId: string;
      title: string | null;
      createdAt: string;
      updatedAt: string;
    }>
  > {
    const body: { title?: string } = {};
    if (typeof title === 'string' && !/[\0\r\n]/.test(title) && title.trim()) {
      body.title = title.trim().slice(0, 200);
    }
    return this.requestEnvelope(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/conversations`,
      body,
    );
  }

  listMessages(
    projectId: string,
    conversationId: string,
  ): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        conversationId: string;
        role: 'user' | 'assistant' | 'system';
        content: string;
        agentId?: string | null;
        createdAt: string;
      }>
    >
  > {
    return this.request(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
    );
  }

  addMessage(
    projectId: string,
    conversationId: string,
    input: { role?: 'user' | 'assistant' | 'system'; content: string; agentId?: string },
  ): Promise<
    ApiEnvelope<{
      id: string;
      conversationId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      agentId?: string | null;
      createdAt: string;
    }>
  > {
    if (typeof input.content !== 'string' || /\0/.test(input.content) || !input.content.trim()) {
      return Promise.resolve({ ok: false, error: 'Invalid content' });
    }
    const body: { role?: string; content: string; agentId?: string } = {
      content: input.content,
    };
    if (input.role) body.role = input.role;
    if (
      input.agentId != null
      && typeof input.agentId === 'string'
      && !/[\0\r\n]/.test(input.agentId)
      && input.agentId.trim()
    ) {
      body.agentId = input.agentId.trim();
    }
    return this.requestEnvelope(
      'POST',
      `/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
      body,
    );
  }

  /**
   * POST /api/runs — start an agent run.
   * Returns full envelope on HTTP errors (does not throw on 4xx/5xx).
   */
  createRun(input: {
    projectId: string;
    prompt: string;
    agentId?: string;
    editContext?: unknown;
    /** Collab presence session bind for agent lock identity (v0.11 M0). */
    sessionId?: string;
  }): Promise<ApiEnvelope<ProjectRunSummary>> {
    const body: Record<string, unknown> = {
      projectId: input.projectId,
      prompt: input.prompt,
    };
    if (input.agentId) body.agentId = input.agentId;
    if (input.editContext != null) body.editContext = input.editContext;
    const sessionId = this.collabSessionId(input.sessionId);
    if (sessionId && sessionId.length <= 64) {
      body.sessionId = sessionId;
    }
    return this.requestEnvelope('POST', '/api/runs', body, {
      headers: this.collabSessionHeaders(
        sessionId && sessionId.length <= 64 ? sessionId : '',
      ),
    });
  }

  getRun(runId: string): Promise<ApiEnvelope<ProjectRunSummary>> {
    return this.request('GET', `/api/runs/${encodeURIComponent(runId)}`);
  }

  /** GET /api/runs?projectId= — list runs for a project. */
  listRuns(projectId: string): Promise<ApiEnvelope<ProjectRunSummary[]>> {
    return this.request(
      'GET',
      `/api/runs?projectId=${encodeURIComponent(projectId)}`,
    );
  }

  /** GET /api/runs/:id/events — event history (?after=eventId). */
  listRunEvents(
    runId: string,
    after?: string,
  ): Promise<ApiEnvelope<ProjectRunEvent[]>> {
    let qs = '';
    if (after != null && after !== '') {
      if (typeof after === 'string' && !/[\0\r\n]/.test(after)) {
        const a = after.trim();
        if (a) qs = `?after=${encodeURIComponent(a)}`;
      }
    }
    return this.request(
      'GET',
      `/api/runs/${encodeURIComponent(runId)}/events${qs}`,
    );
  }

  /**
   * POST /api/runs/:id/cancel
   * Uses requestEnvelope so 409 (already terminal) does not throw.
   */
  cancelRun(runId: string): Promise<ApiEnvelope<ProjectRunSummary>> {
    return this.requestEnvelope(
      'POST',
      `/api/runs/${encodeURIComponent(runId)}/cancel`,
    );
  }

  /**
   * GET /api/runs/:id/events/stream — live run events (stdout / terminal).
   * Mirrors desktop `streamProjectRunEvents`. Returns abort callback.
   * Prefer over polling for Edit-with-AI; callers should fall back to
   * `listRunEvents` + `getRun` if the stream errors or yields nothing.
   */
  streamRunEvents(
    runId: string,
    onEvent: (event: {
      type: string;
      id?: string;
      ts?: string;
      data?: unknown;
    }) => void,
    opts?: { onDone?: () => void; onError?: (err: unknown) => void },
  ): () => void {
    const controller = new AbortController();
    if (
      typeof runId !== 'string'
      || !runId.trim()
      || /[\0\r\n]/.test(runId)
      || runId.length > 100
    ) {
      queueMicrotask(() => opts?.onError?.(new Error('Invalid run id')));
      return () => {};
    }
    const seg = encodeURIComponent(runId.trim());
    void (async () => {
      try {
        const res = await fetch(this.url(`/api/runs/${seg}/events/stream`), {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          if (!controller.signal.aborted) {
            opts?.onError?.(
              new Error(res.statusText || `HTTP ${res.status}` || 'Stream failed'),
            );
          }
          return;
        }
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
              let payload = line.slice(5);
              if (payload.startsWith(' ')) payload = payload.slice(1);
              if (payload.endsWith('\r')) payload = payload.slice(0, -1);
              payload = payload.trim();
              if (!payload || /\0/.test(payload)) continue;
              try {
                const parsed = JSON.parse(payload) as Record<string, unknown>;
                const type =
                  typeof parsed.type === 'string' && parsed.type
                    ? parsed.type
                    : eventName;
                onEvent({
                  type,
                  id: typeof parsed.id === 'string' ? parsed.id : undefined,
                  ts: typeof parsed.ts === 'string' ? parsed.ts : undefined,
                  data: 'data' in parsed ? parsed.data : undefined,
                });
              } catch {
                // skip malformed JSON
              }
              eventName = 'message';
            } else if (line === '' || line === '\r') {
              eventName = 'message';
            }
          }
        }
        if (!controller.signal.aborted) {
          opts?.onDone?.();
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        opts?.onError?.(err);
      }
    })();
    return () => controller.abort();
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

  /** GET /api/settings — all settings (sensitive values masked). */
  getSettings(): Promise<ApiEnvelope<Record<string, string>>> {
    return this.request('GET', '/api/settings');
  }

  /**
   * PUT /api/settings/:key — create/update (or clear sensitive via empty string).
   * Envelope: does not throw on HTTP errors.
   */
  saveSetting(key: string, value: string): Promise<ApiEnvelope<{ deleted?: boolean } | void>> {
    if (typeof key !== 'string' || !key.trim() || /[\0\r\n]/.test(key) || key.length > 100) {
      return Promise.resolve({ ok: false, error: 'Invalid setting key' });
    }
    if (typeof value !== 'string') {
      return Promise.resolve({ ok: false, error: 'Invalid setting value' });
    }
    return this.requestEnvelope(
      'PUT',
      `/api/settings/${encodeURIComponent(key.trim())}`,
      { value },
    );
  }

  /**
   * POST /api/settings/verify-key — validate provider API key (anthropic | google).
   * Envelope: 4xx/5xx do not throw (caller checks ok + data.valid).
   */
  verifyApiKey(
    provider: string,
    key: string,
  ): Promise<ApiEnvelope<{ valid?: boolean }>> {
    return this.requestEnvelope('POST', '/api/settings/verify-key', { provider, key });
  }

  /**
   * GET /api/collab/status — bus + presence/lock registry + shared-edit flags (ops, no secrets).
   */
  getCollabStatus(): Promise<
    ApiEnvelope<{
      bus?: string;
      nodeId?: string;
      ready?: boolean;
      detail?: string | null;
      presence?: { kind?: string; ready?: boolean; detail?: string | null };
      locks?: { kind?: string; ready?: boolean; detail?: string | null };
      sharedEdit?: { hardEnforce?: boolean; agentsHardEnforce?: boolean };
    }>
  > {
    return this.request('GET', '/api/collab/status');
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

  /** Snapshot of advisory file locks (REST helper; multi-replica resync). */
  getCollabLocks(
    projectId: string,
  ): Promise<
    ApiEnvelope<{
      locks?: Array<{
        path: string;
        sessionId: string;
        displayName: string;
        acquiredAt?: string;
      }>;
      hardEnforce?: boolean;
      agentsHardEnforce?: boolean;
    }>
  > {
    return this.requestEnvelope(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}/collab/locks`,
    );
  }

  /** Snapshot of peer selections (REST helper; multi-replica resync). */
  getCollabSelections(
    projectId: string,
  ): Promise<
    ApiEnvelope<{
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
    }>
  > {
    return this.requestEnvelope(
      'GET',
      `/api/projects/${encodeURIComponent(projectId)}/collab/selections`,
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
