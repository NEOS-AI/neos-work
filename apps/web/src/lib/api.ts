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
  nextSseReconnectDelay,
  parseCollabLockConflict,
  parseFileRevisionDetailResponse,
  parseFileRevisionListResponse,
  parsePreviewCommentDetailResponse,
  parsePreviewCommentListResponse,
  parseProjectFileWriteResponse,
  shouldReconnectSse,
  type FileRevision,
  type PreviewComment,
  type ProjectFileContent,
  type ProjectFileEntry,
  type ProjectFileEventPayload,
  type ProjectFileWriteResult,
  type ProjectRunEvent,
  type ProjectRunSummary,
  type SseStreamStatus,
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

export type SkillFetchPath = 'snapshot' | 'zipball' | 'well-known' | 'direct';

export interface RemoteSkillHit {
  id: string;
  slug: string;
  name: string;
  source: string;
  installs: number;
  sourceType: 'github' | 'well-known' | 'unknown';
  installUrl: string | null;
  url: string;
  installed: boolean;
}

export interface CatalogSearchResult {
  query: string;
  searchType: string;
  count: number;
  cached?: boolean;
  stale?: boolean;
  skills: RemoteSkillHit[];
}

export interface CatalogPreviewResult {
  id: string;
  slug: string;
  name: string;
  description: string;
  license?: string;
  hash: string | null;
  fileCount: number;
  files: Array<{ path: string; bytes: number }>;
  skillMd: string;
  truncated: boolean;
  trust: 'unverified';
  sourceUrl: string | null;
  skillsShUrl: string;
  fetchPath: SkillFetchPath;
}

export interface SkillAmbiguousCandidate {
  slug: string;
  name: string;
}

export interface InstallRemoteSkillInput {
  id?: string;
  source?: string;
  slug?: string;
  url?: string;
  ref?: string;
  scope?: 'global' | 'workspace';
  confirm: true;
  includeInternal?: boolean;
}

export interface InstallRemoteSkillResult {
  id: string;
  name: string;
  source: 'remote';
  version: string | null;
  hash: string | null;
  scope: 'global' | 'workspace';
  path: string;
  fetchPath: SkillFetchPath;
  shadowed?: 'bundled';
  unchanged?: boolean;
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

  // ── Media generate (v0.23 dual-surface web) ─────────────────

  /** Media list item from GET /api/media/files. */
  // types inlined so web stays free of desktop engine types

  /**
   * GET /api/media/files?limit= — list generated media files.
   */
  listMediaFiles(
    limit = 100,
  ): Promise<
    ApiEnvelope<
      Array<{
        filename: string;
        size: number;
        kind: 'image' | 'audio' | 'video' | 'other';
        mimeType?: string;
        createdAt?: string;
        urlPath?: string;
      }>
    >
  > {
    const n =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.min(Math.max(Math.floor(limit), 1), 500)
        : 100;
    return this.request('GET', `/api/media/files?limit=${n}`);
  }

  /**
   * GET /api/media/providers — provider catalog (configured flags, no secrets).
   */
  listMediaProviders(): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        label: string;
        surfaces: string[];
        configured: boolean;
        isStub?: boolean;
      }>
    >
  > {
    return this.request('GET', '/api/media/providers');
  }

  /**
   * POST /api/media/generate — unified image | audio | video.
   * Image/video use `prompt`; audio uses `text` (or falls back to `prompt`).
   * Video may return `{ jobId, status }` for async polling via `getMediaJob`.
   * Envelope: does not throw on HTTP errors.
   */
  generateMedia(input: {
    surface: 'image' | 'audio' | 'video';
    prompt?: string;
    text?: string;
    provider?: string;
    model?: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  }): Promise<
    ApiEnvelope<{
      surface?: string;
      filename?: string;
      jobId?: string;
      status?: string;
      provider?: string;
      mimeType?: string;
    }>
  > {
    const surface = input.surface;
    if (surface !== 'image' && surface !== 'audio' && surface !== 'video') {
      return Promise.resolve({ ok: false, error: 'surface must be image, audio, or video' });
    }
    const body: Record<string, string> = { surface };
    if (surface === 'audio') {
      const text = typeof input.text === 'string' ? input.text : input.prompt;
      if (typeof text !== 'string' || /\0/.test(text) || !text.trim()) {
        return Promise.resolve({ ok: false, error: 'text required for audio' });
      }
      body.text = text.trim();
    } else {
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      if (!prompt.trim() || /[\0\r\n]/.test(prompt)) {
        return Promise.resolve({ ok: false, error: 'prompt required (no control characters)' });
      }
      body.prompt = prompt.trim();
    }
    if (
      input.provider != null
      && typeof input.provider === 'string'
      && !/[\0\r\n]/.test(input.provider)
      && input.provider.trim()
    ) {
      body.provider = input.provider.trim();
    }
    if (
      input.model != null
      && typeof input.model === 'string'
      && !/[\0\r\n]/.test(input.model)
      && input.model.trim()
    ) {
      body.model = input.model.trim();
    }
    if (input.size) body.size = input.size;
    if (input.quality) body.quality = input.quality;
    if (input.voice) body.voice = input.voice;

    return this.requestEnvelope('POST', '/api/media/generate', body);
  }

  /**
   * GET /api/media/jobs/:id — poll async video job.
   */
  getMediaJob(
    id: string,
  ): Promise<
    ApiEnvelope<{
      id: string;
      surface: string;
      provider: string;
      status: string;
      filename?: string;
      error?: string;
    }>
  > {
    if (typeof id !== 'string' || !id.trim() || /[\0\r\n]/.test(id) || id.length > 200) {
      return Promise.resolve({ ok: false, error: 'Invalid job id' });
    }
    return this.request(
      'GET',
      `/api/media/jobs/${encodeURIComponent(id.trim())}`,
    );
  }

  /**
   * Absolute URL for a media file (GET /api/media/file/:filename).
   * Returns null when filename fails safe-filename rules.
   */
  mediaFileUrl(filename: string): string | null {
    const seg = this.mediaFilenameSegment(filename);
    if (!seg) return null;
    return this.url(`/api/media/file/${seg}`);
  }

  /**
   * Fetch media file as Blob (auth header; not JSON envelope).
   */
  async fetchMediaBlob(filename: string): Promise<Blob> {
    const seg = this.mediaFilenameSegment(filename);
    if (!seg) throw new Error('Invalid media filename');
    const headers: Record<string, string> = {};
    if (this.token && !/[\0\r\n]/.test(this.token) && this.token.trim()) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const res = await fetch(this.url(`/api/media/file/${seg}`), { headers });
    if (!res.ok) throw new Error(`Failed to load media (${res.status})`);
    return res.blob();
  }

  /**
   * Media filename path segment (align with server isSafeMediaFilename).
   */
  private mediaFilenameSegment(raw: unknown, maxChars = 200): string {
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
    const name = raw.trim();
    if (!name || name === '.' || name === '..') return '';
    if (name.startsWith('.')) return '';
    const max = typeof maxChars === 'number' && maxChars > 0 ? maxChars : 200;
    if (name.length > max) return '';
    if (!/^[a-zA-Z0-9_\-.]+$/.test(name)) return '';
    return encodeURIComponent(name);
  }

  /** Abort-aware backoff used by collab / file SSE reconnect (v0.25 C). */
  private waitReconnect(ms: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    const delay = Number.isFinite(ms) ? Math.max(0, ms) : 400;
    return new Promise((resolve) => {
      const done = () => resolve(!signal.aborted);
      const t = setTimeout(done, delay);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          done();
        },
        { once: true },
      );
    });
  }

  private safeEntityId(raw: unknown, maxChars = 200): string {
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
    const s = raw.trim();
    if (!s || s.length > maxChars) return '';
    return s;
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

  // ── Workflows (v0.24 dual-surface web editor) ──────────────

  /** Workflow list/detail shape from GET /api/workflow. */
  // types inlined so web stays free of desktop engine types

  private safeWorkflowId(raw: unknown, maxChars = 200): string {
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
    const s = raw.trim();
    if (!s || s.length > maxChars) return '';
    return s;
  }

  /**
   * GET /api/workflow — list workflows.
   * Read path: throws ApiError on non-OK HTTP.
   */
  listWorkflows(): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        name: string;
        description?: string;
        domain: string;
        primaryDomain?: string;
        domainPackIds?: string[];
        nodes?: unknown[];
        edges?: unknown[];
        designSystemId?: string;
        createdAt?: string;
        updatedAt?: string;
      }>
    >
  > {
    return this.request('GET', '/api/workflow');
  }

  /**
   * GET /api/workflow/:id — workflow document with graph.
   * Read path: throws ApiError on non-OK HTTP.
   */
  getWorkflow(id: string): Promise<
    ApiEnvelope<{
      id: string;
      name: string;
      description?: string;
      domain: string;
      primaryDomain?: string;
      domainPackIds?: string[];
      nodes: Array<{
        id: string;
        type: string;
        label: string;
        position: { x: number; y: number };
        config: Record<string, unknown>;
      }>;
      edges: Array<{
        id: string;
        source: string;
        target: string;
        label?: string;
      }>;
      designSystemId?: string;
      schemaVersion?: number;
      createdAt?: string;
      updatedAt?: string;
    }>
  > {
    const safe = this.safeWorkflowId(id);
    if (!safe) {
      return Promise.reject(new ApiError('Invalid workflow id', 400));
    }
    return this.request('GET', `/api/workflow/${encodeURIComponent(safe)}`);
  }

  /**
   * POST /api/workflow — create workflow.
   * Envelope: does not throw on HTTP errors.
   */
  createWorkflow(input: {
    name: string;
    description?: string;
    domain?: string;
    primaryDomain?: string;
    domainPackIds?: string[];
    nodes?: unknown[];
    edges?: unknown[];
  }): Promise<
    ApiEnvelope<{
      id: string;
      name: string;
      description?: string;
      domain: string;
      primaryDomain?: string;
      nodes?: unknown[];
      edges?: unknown[];
      createdAt?: string;
      updatedAt?: string;
    }>
  > {
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
      return Promise.resolve({ ok: false, error: 'Invalid name' });
    }
    const body: Record<string, unknown> = {
      name: input.name.trim().slice(0, 200),
    };
    if (typeof input.description === 'string' && !/\0/.test(input.description)) {
      const d = input.description.trim();
      if (d) body.description = d;
    }
    const primary =
      typeof input.primaryDomain === 'string' && input.primaryDomain.trim() && !/[\0\r\n]/.test(input.primaryDomain)
        ? input.primaryDomain.trim().toLowerCase()
        : typeof input.domain === 'string' && input.domain.trim() && !/[\0\r\n]/.test(input.domain)
          ? input.domain.trim().toLowerCase()
          : undefined;
    if (primary) {
      body.primaryDomain = primary;
      body.domain = primary;
    }
    if (Array.isArray(input.domainPackIds)) {
      body.domainPackIds = input.domainPackIds
        .map((p) => (typeof p === 'string' && !/[\0\r\n]/.test(p) ? p.trim().toLowerCase() : ''))
        .filter(Boolean);
    }
    if (Array.isArray(input.nodes)) body.nodes = input.nodes;
    if (Array.isArray(input.edges)) body.edges = input.edges;
    return this.requestEnvelope('POST', '/api/workflow', body);
  }

  /**
   * PUT /api/workflow/:id — update name/domain/graph.
   * Envelope: does not throw on HTTP errors.
   */
  updateWorkflow(
    id: string,
    patch: {
      name?: string;
      description?: string;
      domain?: string;
      primaryDomain?: string;
      domainPackIds?: string[] | null;
      designSystemId?: string;
      nodes?: unknown[];
      edges?: unknown[];
    },
  ): Promise<
    ApiEnvelope<{
      id: string;
      name: string;
      description?: string;
      domain: string;
      primaryDomain?: string;
      nodes?: unknown[];
      edges?: unknown[];
      updatedAt?: string;
    }>
  > {
    const safe = this.safeWorkflowId(id);
    if (!safe) {
      return Promise.resolve({ ok: false, error: 'Invalid workflow id' });
    }
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      if (typeof patch.name !== 'string' || /[\0\r\n]/.test(patch.name) || !patch.name.trim()) {
        return Promise.resolve({ ok: false, error: 'Invalid name' });
      }
      body.name = patch.name.trim().slice(0, 200);
    }
    if (patch.description !== undefined) {
      if (typeof patch.description === 'string' && !/\0/.test(patch.description)) {
        body.description = patch.description.trim();
      } else if (typeof patch.description !== 'string') {
        return Promise.resolve({ ok: false, error: 'Invalid description' });
      }
    }
    if (patch.primaryDomain !== undefined || patch.domain !== undefined) {
      const raw = patch.primaryDomain ?? patch.domain;
      if (typeof raw === 'string' && !/[\0\r\n]/.test(raw) && raw.trim()) {
        const d = raw.trim().toLowerCase();
        body.primaryDomain = d;
        body.domain = d;
      }
    }
    if (patch.domainPackIds === null) {
      body.domainPackIds = null;
    } else if (Array.isArray(patch.domainPackIds)) {
      body.domainPackIds = patch.domainPackIds
        .map((p) => (typeof p === 'string' && !/[\0\r\n]/.test(p) ? p.trim().toLowerCase() : ''))
        .filter(Boolean);
    }
    if (
      patch.designSystemId !== undefined
      && typeof patch.designSystemId === 'string'
      && !/[\0\r\n]/.test(patch.designSystemId)
    ) {
      body.designSystemId = patch.designSystemId.trim() || undefined;
    }
    if (Array.isArray(patch.nodes)) body.nodes = patch.nodes;
    if (Array.isArray(patch.edges)) body.edges = patch.edges;
    if (Object.keys(body).length === 0) {
      return Promise.resolve({ ok: false, error: 'No fields to update' });
    }
    return this.requestEnvelope('PUT', `/api/workflow/${encodeURIComponent(safe)}`, body);
  }

  /**
   * DELETE /api/workflow/:id
   * Envelope: does not throw on HTTP errors.
   */
  deleteWorkflow(id: string): Promise<ApiEnvelope<null>> {
    const safe = this.safeWorkflowId(id);
    if (!safe) {
      return Promise.resolve({ ok: false, error: 'Invalid workflow id' });
    }
    return this.requestEnvelope('DELETE', `/api/workflow/${encodeURIComponent(safe)}`);
  }

  /**
   * GET /api/workflow/:id/runs — list recent runs.
   * Read path: throws ApiError on non-OK HTTP. Returns ok:false envelope for bad id.
   */
  listWorkflowRuns(
    workflowId: string,
    limit = 20,
    offset = 0,
  ): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        workflowId: string;
        status: string;
        startedAt?: string;
        completedAt?: string;
        error?: string;
      }>
    >
  > {
    const safe = this.safeWorkflowId(workflowId);
    if (!safe) {
      return Promise.resolve({ ok: false, error: 'Invalid workflow id' });
    }
    const lim =
      typeof limit === 'number' && Number.isFinite(limit)
        ? Math.min(Math.max(Math.floor(limit), 1), 100)
        : 20;
    const off =
      typeof offset === 'number' && Number.isFinite(offset)
        ? Math.max(Math.floor(offset), 0)
        : 0;
    return this.request(
      'GET',
      `/api/workflow/${encodeURIComponent(safe)}/runs?limit=${lim}&offset=${off}`,
    );
  }

  /**
   * POST /api/workflow/:id/run — execute workflow (SSE stream).
   * Returns abort callback. Emits parsed JSON events to onEvent.
   * Invalid id emits a synthetic run.failed without fetch.
   */
  runWorkflow(
    id: string,
    onEvent: (event: { type: string; runId?: string; nodeId?: string; error?: string; [k: string]: unknown }) => void,
    inputs?: Record<string, unknown>,
  ): () => void {
    const controller = new AbortController();
    const safe = this.safeWorkflowId(id);
    if (!safe) {
      queueMicrotask(() =>
        onEvent({ type: 'run.failed', runId: '', error: 'Invalid workflow id' }),
      );
      return () => {};
    }
    void (async () => {
      try {
        const body =
          inputs && typeof inputs === 'object' ? JSON.stringify({ inputs }) : undefined;
        const res = await fetch(this.url(`/api/workflow/${encodeURIComponent(safe)}/run`), {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body,
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          if (!controller.signal.aborted) {
            onEvent({
              type: 'run.failed',
              runId: '',
              error: res.statusText || `HTTP ${res.status}` || 'Run failed',
            });
          }
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            let payload = line.slice(5);
            if (payload.startsWith(' ')) payload = payload.slice(1);
            if (payload.endsWith('\r')) payload = payload.slice(0, -1);
            payload = payload.trim();
            if (!payload || /\0/.test(payload)) continue;
            try {
              const parsed = JSON.parse(payload) as Record<string, unknown>;
              if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
                onEvent(parsed as { type: string; [k: string]: unknown });
              }
            } catch {
              // skip malformed
            }
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        // network error — silent (caller can treat missing completion as failure)
      }
    })();
    return () => controller.abort();
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
    opts?: {
      displayName?: string;
      onStatus?: (status: SseStreamStatus) => void;
      reconnect?: boolean;
    },
  ): () => void {
    const controller = new AbortController();
    const id = encodeURIComponent(projectId);
    const qs =
      opts?.displayName && !/[\0\r\n]/.test(opts.displayName)
        ? `?name=${encodeURIComponent(opts.displayName.trim().slice(0, 48))}`
        : '';
    const reconnect = opts?.reconnect !== false;
    void (async () => {
      let attempts = 0;
      while (!controller.signal.aborted) {
      try {
        if (attempts > 0) {
          opts?.onStatus?.('reconnecting');
          const waited = await this.waitReconnect(
            nextSseReconnectDelay(attempts),
            controller.signal,
          );
          if (!waited) break;
        }
        const res = await fetch(this.url(`/api/projects/${id}/collab/stream${qs}`), {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          attempts += 1;
          if (
            !reconnect
            || !shouldReconnectSse({ aborted: controller.signal.aborted, attempts })
          ) {
            break;
          }
          continue;
        }
        attempts = 0;
        opts?.onStatus?.('open');
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
        attempts += 1;
        if (
          !reconnect
          || controller.signal.aborted
          || !shouldReconnectSse({ aborted: controller.signal.aborted, attempts })
        ) {
          break;
        }
      } catch {
        if (controller.signal.aborted) break;
        attempts += 1;
        if (!reconnect || !shouldReconnectSse({ attempts })) break;
      }
      }
      opts?.onStatus?.('closed');
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
    opts?: { onStatus?: (status: SseStreamStatus) => void; reconnect?: boolean },
  ): () => void {
    const controller = new AbortController();
    const id = encodeURIComponent(projectId);
    const reconnect = opts?.reconnect !== false;
    void (async () => {
      let attempts = 0;
      while (!controller.signal.aborted) {
      try {
        if (attempts > 0) {
          opts?.onStatus?.('reconnecting');
          const waited = await this.waitReconnect(
            nextSseReconnectDelay(attempts),
            controller.signal,
          );
          if (!waited) break;
        }
        const res = await fetch(this.url(`/api/projects/${id}/events/stream`), {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          attempts += 1;
          if (
            !reconnect
            || !shouldReconnectSse({ aborted: controller.signal.aborted, attempts })
          ) {
            break;
          }
          continue;
        }
        attempts = 0;
        opts?.onStatus?.('open');
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
        attempts += 1;
        if (
          !reconnect
          || controller.signal.aborted
          || !shouldReconnectSse({ aborted: controller.signal.aborted, attempts })
        ) {
          break;
        }
      } catch {
        if (controller.signal.aborted) break;
        attempts += 1;
        if (!reconnect || !shouldReconnectSse({ attempts })) break;
      }
      }
      opts?.onStatus?.('closed');
    })();
    return () => controller.abort();
  }

  // ── Sessions / workspaces (v0.25 Track A) ─────────────────

  listSessions(workspaceId?: string): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        workspace_id?: string;
        workspaceId?: string;
        title: string | null;
        provider: string;
        model: string;
        thinking_mode?: string;
        thinkingMode?: string;
        created_at?: string;
        updated_at?: string;
      }>
    >
  > {
    let qs = '';
    if (workspaceId != null && workspaceId !== '') {
      const id = this.safeEntityId(workspaceId);
      if (!id) return Promise.resolve({ ok: false, error: 'Invalid workspace id' });
      qs = `?workspaceId=${encodeURIComponent(id)}`;
    }
    return this.request('GET', `/api/session${qs}`);
  }

  createSession(input: {
    workspaceId: string;
    title?: string;
    provider?: string;
    model?: string;
    thinkingMode?: string;
  }): Promise<
    ApiEnvelope<{
      id: string;
      workspace_id?: string;
      title: string | null;
      provider: string;
      model: string;
    }>
  > {
    const workspaceId = this.safeEntityId(input.workspaceId);
    if (!workspaceId) {
      return Promise.resolve({ ok: false, error: 'Invalid workspace id' });
    }
    const body: Record<string, string> = { workspaceId };
    if (typeof input.title === 'string' && input.title.trim() && !/[\0\r\n]/.test(input.title)) {
      body.title = input.title.trim().slice(0, 200);
    }
    if (typeof input.provider === 'string' && input.provider.trim() && !/[\0\r\n]/.test(input.provider)) {
      body.provider = input.provider.trim().toLowerCase();
    }
    if (typeof input.model === 'string' && input.model.trim() && !/[\0\r\n]/.test(input.model)) {
      body.model = input.model.trim();
    }
    if (
      typeof input.thinkingMode === 'string'
      && input.thinkingMode.trim()
      && !/[\0\r\n]/.test(input.thinkingMode)
    ) {
      body.thinkingMode = input.thinkingMode.trim().toLowerCase();
    }
    return this.requestEnvelope('POST', '/api/session', body);
  }

  deleteSession(id: string): Promise<ApiEnvelope<null>> {
    const sid = this.safeEntityId(id);
    if (!sid) return Promise.resolve({ ok: false, error: 'Invalid session id' });
    return this.requestEnvelope('DELETE', `/api/session/${encodeURIComponent(sid)}`);
  }

  listSessionMessages(sessionId: string): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        session_id?: string;
        role: string;
        content: string;
        created_at?: string;
      }>
    >
  > {
    const sid = this.safeEntityId(sessionId);
    if (!sid) return Promise.resolve({ ok: false, error: 'Invalid session id' });
    return this.request('GET', `/api/session/${encodeURIComponent(sid)}/messages`);
  }

  cancelSession(sessionId: string): Promise<ApiEnvelope<null>> {
    const sid = this.safeEntityId(sessionId);
    if (!sid) return Promise.resolve({ ok: false, error: 'Invalid session id' });
    return this.requestEnvelope('POST', `/api/session/${encodeURIComponent(sid)}/cancel`);
  }

  confirmSessionTool(
    sessionId: string,
    toolUseId: string,
    approved: boolean,
  ): Promise<ApiEnvelope<null>> {
    const sid = this.safeEntityId(sessionId);
    const tid = this.safeEntityId(toolUseId);
    if (!sid) return Promise.resolve({ ok: false, error: 'Invalid session id' });
    if (!tid) return Promise.resolve({ ok: false, error: 'Invalid tool use id' });
    return this.requestEnvelope(
      'POST',
      `/api/session/${encodeURIComponent(sid)}/tool-confirm/${encodeURIComponent(tid)}`,
      { approved: approved === true },
    );
  }

  streamSessionChat(
    sessionId: string,
    content: string,
    onChunk: (chunk: { type: string; content?: string; toolUseId?: string; toolName?: string }) => void,
    opts?: { onDone?: () => void; onError?: (err: unknown) => void },
  ): () => void {
    const controller = new AbortController();
    const sid = this.safeEntityId(sessionId);
    if (!sid || typeof content !== 'string' || /\0/.test(content) || !content.trim()) {
      queueMicrotask(() => opts?.onError?.(new Error('Invalid chat')));
      return () => {};
    }
    void (async () => {
      try {
        const res = await fetch(this.url(`/api/session/${encodeURIComponent(sid)}/chat`), {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          },
          body: JSON.stringify({ content: content.trim() }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          if (!controller.signal.aborted) {
            opts?.onError?.(new Error(res.statusText || `HTTP ${res.status}` || 'Chat failed'));
          }
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            let payload = line.slice(5);
            if (payload.startsWith(' ')) payload = payload.slice(1);
            payload = payload.trim();
            if (!payload || /\0/.test(payload)) continue;
            try {
              const parsed = JSON.parse(payload) as Record<string, unknown>;
              onChunk({
                type: typeof parsed.type === 'string' ? parsed.type : 'text',
                content: typeof parsed.content === 'string' ? parsed.content : undefined,
                toolUseId: typeof parsed.toolUseId === 'string' ? parsed.toolUseId : undefined,
                toolName: typeof parsed.toolName === 'string' ? parsed.toolName : undefined,
              });
            } catch {
              // skip
            }
          }
        }
        if (!controller.signal.aborted) opts?.onDone?.();
      } catch (err) {
        if (controller.signal.aborted) return;
        opts?.onError?.(err);
      }
    })();
    return () => controller.abort();
  }

  listWorkspaces(): Promise<
    ApiEnvelope<Array<{ id: string; name: string; path?: string | null; type: string }>>
  > {
    return this.request('GET', '/api/workspace');
  }

  createWorkspace(input: { name: string; path?: string; type?: string }): Promise<
    ApiEnvelope<{ id: string; name: string; path?: string | null; type: string }>
  > {
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
      return Promise.resolve({ ok: false, error: 'Invalid workspace name' });
    }
    const body: { name: string; path?: string; type?: string } = {
      name: input.name.trim().slice(0, 200),
    };
    if (typeof input.path === 'string' && input.path.trim() && !/[\0\r\n]/.test(input.path)) {
      body.path = input.path.trim();
    }
    if (typeof input.type === 'string' && input.type.trim() && !/[\0\r\n]/.test(input.type)) {
      body.type = input.type.trim();
    }
    return this.requestEnvelope('POST', '/api/workspace', body);
  }

  deleteWorkspace(id: string): Promise<ApiEnvelope<null>> {
    const wid = this.safeEntityId(id);
    if (!wid) return Promise.resolve({ ok: false, error: 'Invalid workspace id' });
    if (wid === 'default') {
      return Promise.resolve({ ok: false, error: 'Cannot delete default workspace' });
    }
    return this.requestEnvelope('DELETE', `/api/workspace/${encodeURIComponent(wid)}`);
  }

  // ── Memory (v0.25 Track A) ────────────────────────────────

  listMemories(): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        name: string;
        type: string;
        enabled: boolean;
        content: string;
        filePath?: string;
        createdAt?: string;
        updatedAt?: string;
      }>
    >
  > {
    return this.request('GET', '/api/memory');
  }

  createMemory(input: {
    name: string;
    type: string;
    content: string;
    enabled?: boolean;
  }): Promise<ApiEnvelope<{ id: string; name: string; type: string; enabled: boolean; content: string }>> {
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
      return Promise.resolve({ ok: false, error: 'Invalid name' });
    }
    if (typeof input.content !== 'string' || /\0/.test(input.content) || !input.content.trim()) {
      return Promise.resolve({ ok: false, error: 'Invalid content' });
    }
    const type =
      typeof input.type === 'string' && !/[\0\r\n]/.test(input.type) ? input.type.trim() : '';
    if (!type || !['user', 'session', 'skill', 'reference'].includes(type)) {
      return Promise.resolve({ ok: false, error: 'Invalid type' });
    }
    return this.requestEnvelope('POST', '/api/memory', {
      name: input.name.trim().slice(0, 200),
      type,
      content: input.content.trim(),
      enabled: input.enabled !== false,
    });
  }

  updateMemory(
    id: string,
    input: { name?: string; type?: string; content?: string; enabled?: boolean },
  ): Promise<ApiEnvelope<{ id: string; name: string; type: string; enabled: boolean; content: string }>> {
    const mid = this.safeEntityId(id);
    if (!mid) return Promise.resolve({ ok: false, error: 'Invalid memory id' });
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
        return Promise.resolve({ ok: false, error: 'Invalid name' });
      }
      body.name = input.name.trim().slice(0, 200);
    }
    if (input.type !== undefined) {
      if (
        typeof input.type !== 'string'
        || /[\0\r\n]/.test(input.type)
        || !['user', 'session', 'skill', 'reference'].includes(input.type.trim())
      ) {
        return Promise.resolve({ ok: false, error: 'Invalid type' });
      }
      body.type = input.type.trim();
    }
    if (input.content !== undefined) {
      if (typeof input.content !== 'string' || /\0/.test(input.content)) {
        return Promise.resolve({ ok: false, error: 'Invalid content' });
      }
      body.content = input.content;
    }
    if (typeof input.enabled === 'boolean') body.enabled = input.enabled;
    if (Object.keys(body).length === 0) {
      return Promise.resolve({ ok: false, error: 'No fields to update' });
    }
    return this.requestEnvelope('PUT', `/api/memory/${encodeURIComponent(mid)}`, body);
  }

  deleteMemory(id: string): Promise<ApiEnvelope<null>> {
    const mid = this.safeEntityId(id);
    if (!mid) return Promise.resolve({ ok: false, error: 'Invalid memory id' });
    return this.requestEnvelope('DELETE', `/api/memory/${encodeURIComponent(mid)}`);
  }

  toggleMemory(id: string): Promise<
    ApiEnvelope<{ id: string; name: string; type: string; enabled: boolean; content: string }>
  > {
    const mid = this.safeEntityId(id);
    if (!mid) return Promise.resolve({ ok: false, error: 'Invalid memory id' });
    return this.requestEnvelope('PUT', `/api/memory/${encodeURIComponent(mid)}/toggle`);
  }

  // ── Plugins / workers / packs (v0.25 Track A) ─────────────

  listPlugins(): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        name: string;
        description?: string;
        version?: string;
        channel?: string;
        trust?: string;
      }>
    >
  > {
    return this.request('GET', '/api/plugins');
  }

  fetchMarketplaceCatalog(url?: string): Promise<
    ApiEnvelope<{
      schemaVersion?: string;
      name?: string;
      entries?: Array<{
        id: string;
        name: string;
        description?: string;
        version: string;
        trust: string;
        packageUrl: string;
      }>;
      sourceUrl?: string;
    }>
  > {
    const qs =
      url && typeof url === 'string' && !/[\0\r\n]/.test(url) && url.trim()
        ? `?url=${encodeURIComponent(url.trim())}`
        : '';
    return this.request('GET', `/api/marketplace/catalog${qs}`);
  }

  installMarketplaceEntry(input: {
    id?: string;
    url?: string;
  }): Promise<ApiEnvelope<{ id?: string; version?: string; message?: string }>> {
    const body: { id?: string; url?: string } = {};
    if (typeof input.id === 'string' && input.id.trim() && !/[\0\r\n]/.test(input.id)) {
      body.id = input.id.trim();
    }
    if (typeof input.url === 'string' && input.url.trim() && !/[\0\r\n]/.test(input.url)) {
      body.url = input.url.trim();
    }
    if (!body.id && !body.url) {
      return Promise.resolve({ ok: false, error: 'id or url required' });
    }
    return this.requestEnvelope('POST', '/api/marketplace/install', body);
  }

  listWorkers(domain?: string): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        name: string;
        description?: string;
        domain?: string;
        isBuiltIn?: boolean;
        mode?: string;
      }>
    >
  > {
    const q =
      typeof domain === 'string' && domain.trim() && !/[\0\r\n]/.test(domain)
        ? `?domain=${encodeURIComponent(domain.trim().toLowerCase())}`
        : '';
    return this.request('GET', `/api/workers${q}`);
  }

  listDomainPacks(): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        name: string;
        description?: string;
        workerCount?: number;
        blockCount?: number;
        isBuiltIn?: boolean;
        enabled?: boolean;
        version?: string;
      }>
    >
  > {
    return this.request('GET', '/api/domain-packs');
  }

  installDomainPackFromZip(zip: Blob | File): Promise<ApiEnvelope<Record<string, unknown>>> {
    return this.postZip('/api/domain-packs/install-zip', zip, 10 * 1024 * 1024);
  }

  getMarketplaceCatalogUrl(): Promise<ApiEnvelope<{ url: string | null }>> {
    return this.request('GET', '/api/marketplace/catalog-url');
  }

  setMarketplaceCatalogUrl(url: string): Promise<ApiEnvelope<{ url: string | null }>> {
    if (typeof url !== 'string' || /[\0\r\n]/.test(url)) {
      return Promise.resolve({ ok: false, error: 'Invalid catalog URL' });
    }
    return this.requestEnvelope('PUT', '/api/marketplace/catalog-url', { url: url.trim() });
  }

  // ── Skills / blocks / templates / design systems / routines / deploy (v0.26) ─

  listSkills(): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        name: string;
        description?: string | null;
        source?: string;
        version?: string | null;
        enabled: boolean;
        category?: string;
        mode?: string;
      }>
    >
  > {
    return this.request('GET', '/api/skills');
  }

  scanSkills(): Promise<ApiEnvelope<{ scanned?: number; total?: number }>> {
    return this.requestEnvelope('POST', '/api/skills/scan');
  }

  toggleSkill(id: string, enabled: boolean): Promise<ApiEnvelope<null>> {
    const sid = this.safeEntityId(id);
    if (!sid) return Promise.resolve({ ok: false, error: 'Invalid skill id' });
    return this.requestEnvelope('POST', `/api/skills/${encodeURIComponent(sid)}/toggle`, {
      enabled: enabled === true,
    });
  }

  deleteSkill(id: string): Promise<ApiEnvelope<null>> {
    const sid = this.safeEntityId(id);
    if (!sid) return Promise.resolve({ ok: false, error: 'Invalid skill id' });
    return this.requestEnvelope('DELETE', `/api/skills/${encodeURIComponent(sid)}`);
  }

  /**
   * GET /api/skills/catalog/search — skills.sh search (min 2 chars).
   * Envelope: 403 catalogDisabled / 4xx do not throw.
   */
  searchSkillCatalog(
    q: string,
    opts?: { limit?: number; owner?: string },
  ): Promise<ApiEnvelope<CatalogSearchResult>> {
    const query = safeCatalogQuery(q);
    if (query.length < 2) return Promise.resolve({ ok: false, error: 'query_too_short' });
    const params = new URLSearchParams();
    params.set('q', query);
    if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit)) {
      params.set('limit', String(Math.max(1, Math.min(50, Math.trunc(opts.limit)))));
    }
    if (typeof opts?.owner === 'string' && opts.owner.trim()) {
      const owner = safeCatalogOwner(opts.owner);
      if (!owner) return Promise.resolve({ ok: false, error: 'invalid_id' });
      params.set('owner', owner);
    }
    return this.requestEnvelope('GET', `/api/skills/catalog/search?${params}`);
  }

  /**
   * GET /api/skills/catalog/preview — SKILL.md excerpt + license.
   * Envelope: 4xx/5xx do not throw.
   */
  previewRemoteSkill(input: {
    id?: string;
    url?: string;
  }): Promise<ApiEnvelope<CatalogPreviewResult>> {
    const params = new URLSearchParams();
    const id = safeCatalogId(input.id);
    const url = safeCatalogUrl(input.url);
    if (id) params.set('id', id);
    else if (url) params.set('url', url);
    else return Promise.resolve({ ok: false, error: 'invalid_id' });
    return this.requestEnvelope('GET', `/api/skills/catalog/preview?${params}`);
  }

  /**
   * POST /api/skills/install — remote ingest. `confirm: true` is required
   * (never send an unverified install without an explicit confirm).
   */
  installRemoteSkill(
    input: InstallRemoteSkillInput,
  ): Promise<ApiEnvelope<InstallRemoteSkillResult> & { candidates?: SkillAmbiguousCandidate[] }> {
    if (input.confirm !== true) {
      return Promise.resolve({ ok: false, error: 'confirm_required' });
    }
    const body: Record<string, unknown> = { confirm: true };
    const id = safeCatalogId(input.id);
    if (id) body.id = id;
    if (typeof input.source === 'string' && !/[\0\r\n]/.test(input.source) && input.source.trim()) {
      body.source = input.source.trim().slice(0, 200);
    }
    if (typeof input.slug === 'string' && !/[\0\r\n]/.test(input.slug) && input.slug.trim()) {
      body.slug = input.slug.trim().slice(0, 200);
    }
    const url = safeCatalogUrl(input.url);
    if (url) body.url = url;
    if (typeof input.ref === 'string' && !/[\0\r\n]/.test(input.ref) && input.ref.trim()) {
      body.ref = input.ref.trim().slice(0, 200);
    }
    if (input.scope === 'global' || input.scope === 'workspace') body.scope = input.scope;
    if (input.includeInternal === true) body.includeInternal = true;
    return this.requestEnvelope('POST', '/api/skills/install', body);
  }

  listBlocks(domain?: string): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        name: string;
        domain: string;
        category?: string;
        description?: string;
        isBuiltIn?: boolean;
        implementationType?: string;
        promptTemplate?: string;
      }>
    >
  > {
    const q =
      typeof domain === 'string' && domain.trim() && !/[\0\r\n]/.test(domain)
        ? `?domain=${encodeURIComponent(domain.trim().toLowerCase())}`
        : '';
    return this.request('GET', `/api/blocks${q}`);
  }

  createBlock(input: {
    id: string;
    name: string;
    domain?: string;
    category?: string;
    description?: string;
    implementationType?: string;
    promptTemplate?: string;
    inputDescription?: string;
    outputDescription?: string;
    paramDefs?: unknown[];
  }): Promise<ApiEnvelope<{ id: string; name: string }>> {
    if (typeof input.id !== 'string' || /[\0\r\n]/.test(input.id) || !input.id.trim()) {
      return Promise.resolve({ ok: false, error: 'Invalid id' });
    }
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
      return Promise.resolve({ ok: false, error: 'Invalid name' });
    }
    const impl = input.implementationType ?? 'prompt';
    if (impl !== 'native' && impl !== 'prompt' && impl !== 'skill') {
      return Promise.resolve({ ok: false, error: 'Invalid implementationType' });
    }
    const body: Record<string, unknown> = {
      id: input.id.trim(),
      name: input.name.trim().slice(0, 200),
      domain: input.domain?.trim() || 'general',
      category: input.category?.trim() || 'custom',
      description: input.description ?? '',
      implementationType: impl,
      paramDefs: Array.isArray(input.paramDefs) ? input.paramDefs : [],
      inputDescription: input.inputDescription ?? '',
      outputDescription: input.outputDescription ?? '',
    };
    if (typeof input.promptTemplate === 'string' && !/\0/.test(input.promptTemplate)) {
      body.promptTemplate = input.promptTemplate;
    }
    return this.requestEnvelope('POST', '/api/blocks', body);
  }

  deleteBlock(id: string): Promise<ApiEnvelope<null>> {
    const bid = this.safeEntityId(id);
    if (!bid) return Promise.resolve({ ok: false, error: 'Invalid block id' });
    return this.requestEnvelope('DELETE', `/api/blocks/${encodeURIComponent(bid)}`);
  }

  listTemplates(domain?: string): Promise<
    ApiEnvelope<
      Array<{
        name: string;
        description?: string;
        domain?: string;
        primaryDomain?: string;
        nodes?: unknown[];
        edges?: unknown[];
      }>
    >
  > {
    const q =
      typeof domain === 'string' && domain.trim() && !/[\0\r\n]/.test(domain)
        ? `?domain=${encodeURIComponent(domain.trim().toLowerCase())}`
        : '';
    return this.request('GET', `/api/templates${q}`);
  }

  listDesignSystems(): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        name: string;
        description?: string;
        source?: string;
        hasManifest?: boolean;
        createdAt?: string;
        updatedAt?: string;
      }>
    >
  > {
    return this.request('GET', '/api/design-systems');
  }

  createDesignSystem(name: string, description?: string): Promise<
    ApiEnvelope<{ id: string; name: string; description?: string }>
  > {
    if (typeof name !== 'string' || /[\0\r\n]/.test(name) || !name.trim()) {
      return Promise.resolve({ ok: false, error: 'Invalid name' });
    }
    const body: { name: string; description?: string } = { name: name.trim().slice(0, 200) };
    if (typeof description === 'string' && !/\0/.test(description) && description.trim()) {
      body.description = description.trim();
    }
    return this.requestEnvelope('POST', '/api/design-systems', body);
  }

  deleteDesignSystem(id: string): Promise<ApiEnvelope<null>> {
    const did = this.safeEntityId(id);
    if (!did) return Promise.resolve({ ok: false, error: 'Invalid design system id' });
    return this.requestEnvelope('DELETE', `/api/design-systems/${encodeURIComponent(did)}`);
  }

  getDesignSystemContent(id: string): Promise<ApiEnvelope<{ content: string }>> {
    const did = this.safeEntityId(id);
    if (!did) return Promise.resolve({ ok: false, error: 'Invalid design system id' });
    return this.request('GET', `/api/design-systems/${encodeURIComponent(did)}/content`);
  }

  saveDesignSystemContent(id: string, content: string): Promise<ApiEnvelope<null>> {
    const did = this.safeEntityId(id);
    if (!did) return Promise.resolve({ ok: false, error: 'Invalid design system id' });
    if (typeof content !== 'string' || /\0/.test(content)) {
      return Promise.resolve({ ok: false, error: 'Invalid content' });
    }
    return this.requestEnvelope('PUT', `/api/design-systems/${encodeURIComponent(did)}/content`, {
      content,
    });
  }

  listRoutines(): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        name: string;
        workflowId: string;
        schedule: string;
        timezone?: string;
        enabled: boolean;
        lastRunAt?: string;
      }>
    >
  > {
    return this.request('GET', '/api/routines');
  }

  createRoutine(input: {
    name: string;
    workflowId: string;
    schedule: string;
    timezone?: string;
    enabled?: boolean;
  }): Promise<ApiEnvelope<{ id: string; name: string; workflowId: string; schedule: string }>> {
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
      return Promise.resolve({ ok: false, error: 'Invalid name' });
    }
    const workflowId = this.safeEntityId(input.workflowId);
    if (!workflowId) return Promise.resolve({ ok: false, error: 'Invalid workflow id' });
    if (typeof input.schedule !== 'string' || /[\0\r\n]/.test(input.schedule) || !input.schedule.trim()) {
      return Promise.resolve({ ok: false, error: 'Invalid schedule' });
    }
    const body: Record<string, unknown> = {
      name: input.name.trim().slice(0, 200),
      workflowId,
      schedule: input.schedule.trim(),
      enabled: input.enabled !== false,
    };
    if (typeof input.timezone === 'string' && input.timezone.trim() && !/[\0\r\n]/.test(input.timezone)) {
      body.timezone = input.timezone.trim();
    }
    return this.requestEnvelope('POST', '/api/routines', body);
  }

  updateRoutine(
    id: string,
    input: { name?: string; schedule?: string; timezone?: string; enabled?: boolean },
  ): Promise<ApiEnvelope<{ id: string; enabled?: boolean }>> {
    const rid = this.safeEntityId(id);
    if (!rid) return Promise.resolve({ ok: false, error: 'Invalid routine id' });
    const body: Record<string, unknown> = {};
    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
        return Promise.resolve({ ok: false, error: 'Invalid name' });
      }
      body.name = input.name.trim();
    }
    if (input.schedule !== undefined) {
      if (typeof input.schedule !== 'string' || /[\0\r\n]/.test(input.schedule) || !input.schedule.trim()) {
        return Promise.resolve({ ok: false, error: 'Invalid schedule' });
      }
      body.schedule = input.schedule.trim();
    }
    if (input.timezone !== undefined) {
      if (typeof input.timezone !== 'string' || /[\0\r\n]/.test(input.timezone)) {
        return Promise.resolve({ ok: false, error: 'Invalid timezone' });
      }
      body.timezone = input.timezone.trim();
    }
    if (typeof input.enabled === 'boolean') body.enabled = input.enabled;
    if (Object.keys(body).length === 0) {
      return Promise.resolve({ ok: false, error: 'No fields to update' });
    }
    return this.requestEnvelope('PUT', `/api/routines/${encodeURIComponent(rid)}`, body);
  }

  deleteRoutine(id: string): Promise<ApiEnvelope<null>> {
    const rid = this.safeEntityId(id);
    if (!rid) return Promise.resolve({ ok: false, error: 'Invalid routine id' });
    return this.requestEnvelope('DELETE', `/api/routines/${encodeURIComponent(rid)}`);
  }

  runRoutineNow(id: string): Promise<ApiEnvelope<{ runId?: string }>> {
    const rid = this.safeEntityId(id);
    if (!rid) return Promise.resolve({ ok: false, error: 'Invalid routine id' });
    return this.requestEnvelope('POST', `/api/routines/${encodeURIComponent(rid)}/run`);
  }

  listDeployments(workflowId?: string): Promise<
    ApiEnvelope<
      Array<{
        id: string;
        workflowId?: string;
        provider: string;
        projectName?: string;
        url?: string;
        status: string;
        statusMessage?: string;
        createdAt?: string;
      }>
    >
  > {
    const qs =
      typeof workflowId === 'string' && workflowId.trim() && !/[\0\r\n]/.test(workflowId)
        ? `?workflowId=${encodeURIComponent(workflowId.trim())}`
        : '';
    return this.request('GET', `/api/deploy${qs}`);
  }

  createDeployment(input: {
    provider: 'vercel' | 'cloudflare';
    content: string;
    projectName?: string;
    workflowId?: string;
  }): Promise<ApiEnvelope<{ id: string; status?: string; url?: string }>> {
    if (input.provider !== 'vercel' && input.provider !== 'cloudflare') {
      return Promise.resolve({ ok: false, error: 'provider must be vercel or cloudflare' });
    }
    if (typeof input.content !== 'string' || /\0/.test(input.content) || !input.content.trim()) {
      return Promise.resolve({ ok: false, error: 'content required' });
    }
    const body: Record<string, string> = {
      provider: input.provider,
      content: input.content,
    };
    if (typeof input.projectName === 'string' && input.projectName.trim() && !/[\0\r\n]/.test(input.projectName)) {
      body.projectName = input.projectName.trim();
    }
    const wf = this.safeEntityId(input.workflowId ?? '');
    if (wf) body.workflowId = wf;
    return this.requestEnvelope('POST', '/api/deploy', body);
  }

  refreshDeployment(id: string): Promise<ApiEnvelope<{ id: string; status?: string }>> {
    const did = this.safeEntityId(id);
    if (!did) return Promise.resolve({ ok: false, error: 'Invalid deployment id' });
    return this.requestEnvelope('POST', `/api/deploy/${encodeURIComponent(did)}/refresh`);
  }

  deleteDeployment(id: string): Promise<ApiEnvelope<null>> {
    const did = this.safeEntityId(id);
    if (!did) return Promise.resolve({ ok: false, error: 'Invalid deployment id' });
    return this.requestEnvelope('DELETE', `/api/deploy/${encodeURIComponent(did)}`);
  }

  deployPreflight(
    provider: 'vercel' | 'cloudflare',
    projectName?: string,
  ): Promise<
    ApiEnvelope<{
      provider?: string;
      ready?: boolean;
      checks?: Array<{ key: string; ok: boolean; message: string }>;
    }>
  > {
    if (provider !== 'vercel' && provider !== 'cloudflare') {
      return Promise.resolve({ ok: false, error: 'Invalid provider' });
    }
    const body: { provider: string; projectName?: string } = { provider };
    if (typeof projectName === 'string' && projectName.trim() && !/[\0\r\n]/.test(projectName)) {
      body.projectName = projectName.trim();
    }
    return this.requestEnvelope('POST', '/api/deploy/preflight', body);
  }

  private async postZip(
    path: string,
    zip: Blob | File,
    maxBytes: number,
  ): Promise<ApiEnvelope<Record<string, unknown>>> {
    try {
      if (!zip || typeof zip.size !== 'number') return { ok: false, error: 'Invalid zip' };
      if (zip.size <= 0) return { ok: false, error: 'Empty zip' };
      if (zip.size > maxBytes) return { ok: false, error: 'zip too large' };
      const form = new FormData();
      const name =
        zip instanceof File && typeof zip.name === 'string' && zip.name.trim()
          ? zip.name.replace(/[\0\r\n]/g, '_').slice(0, 200)
          : 'pack.zip';
      form.append('file', zip, name);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      const res = await fetch(this.url(path), { method: 'POST', headers, body: form });
      try {
        const json: unknown = await res.json();
        if (json && typeof json === 'object' && !Array.isArray(json)) {
          const envelope = json as ApiEnvelope<Record<string, unknown>>;
          if (envelope.ok === undefined) return { ...envelope, ok: res.ok };
          return envelope;
        }
        return { ok: res.ok, data: json as Record<string, unknown> };
      } catch {
        return { ok: false, error: res.ok ? 'Invalid response' : `HTTP ${res.status}` };
      }
    } catch (err) {
      return {
        ok: false,
        error: (err instanceof Error ? err.message : 'Install failed')
          .replace(/[\0\r\n]+/g, ' ')
          .slice(0, 300),
      };
    }
  }
}

/** Printable ASCII catalog id (owner/repo/slug). */
function safeCatalogId(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > 200) return '';
  if (id.includes('..')) return '';
  if (!/^[a-zA-Z0-9._/-]+$/.test(id)) return '';
  return id;
}

function safeCatalogOwner(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const owner = raw.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(owner)) return '';
  return owner;
}

function safeCatalogQuery(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim().slice(0, 200);
}

function safeCatalogUrl(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const url = raw.trim();
  if (!url || url.length > 2_048) return '';
  if (!/^https:\/\//i.test(url)) return '';
  return url;
}
