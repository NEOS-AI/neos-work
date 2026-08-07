/**
 * Design Project + collab API surface on the desktop engine client.
 * v0.12 M0: extracted from engine.ts (EngineClient extends this).
 */

import {
  parseCollabLockConflict,
  parseCollabLockSuccess,
  parseProjectFileWriteResponse,
  type ApiResponse,
  type ProjectFileContent,
  type ProjectFileEventPayload,
  type ProjectFileWriteResult,
  type ProjectRunEvent,
  type ProjectRunSummary,
} from '@neos-work/shared';
import {
  EngineTransport,
  formatHttpErrorMessage,
  parseSseDataPayload,
  parseSseEventName,
  readApiResponse,
  scrubApiErrorMessage,
} from './engine-transport.js';

/** Design Project (v0.5 Open Design surface). */
export interface DesignProject {
  id: string;
  name: string;
  baseDir: string;
  entryFile: string | null;
  designSystemId: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  mtimeMs?: number;
  isEntry?: boolean;
}

export interface ProjectFileRevision {
  id: string;
  projectId: string;
  path: string;
  contentHash: string;
  content?: string;
  source: 'user' | 'agent' | 'import' | 'restore';
  createdAt: string;
}

export interface ProjectPreviewComment {
  id: string;
  projectId: string;
  filePath: string;
  selector: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
}

/** Project chat conversation (persisted multi-turn history). */
export interface ProjectConversation {
  id: string;
  projectId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Message within a project conversation. */
export interface ProjectMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string | null;
  createdAt: string;
}

/** Marketplace channel for plugin list filters (server plugin-store). */
export type PluginChannel = 'user' | 'official' | 'community' | 'bundled';

export interface Plugin {
  id: string;
  name: string;
  description?: string;
  version: string;
  /** Marketplace channel when known. */
  channel?: PluginChannel;
  pipeline?: Array<{
    id: string;
    name: string;
    kind: string;
    humanInLoop?: boolean;
    schema?: unknown;
  }>;
  inputFields?: Array<{ key: string; label: string; type: string; placeholder?: string }>;
}

export interface PluginListMeta {
  total?: number;
  channels?: Partial<Record<PluginChannel, number>>;
}

export interface Artifact {
  id: string;
  workflowId: string;
  runId?: string;
  name: string;
  contentType: string;
  content?: string;
  nodeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Routine {
  id: string;
  name: string;
  workflowId: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  inputs: Record<string, unknown>;
  lastRunAt?: string;
  /** Estimated next schedule fire (ISO), when enabled */
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaFileInfo {
  filename: string;
  size: number;
  kind: 'image' | 'audio' | 'video' | 'other';
  mimeType: string;
  createdAt: string;
  urlPath: string;
}

export interface LiveArtifact {
  id: string;
  projectId: string;
  name: string;
  sourceTemplate?: string | null;
  inputs?: Record<string, unknown>;
  content?: string | null;
  contentType?: string;
  sidecarPath?: string | null;
  refreshCount?: number;
  lastRefreshedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiveArtifactRefresh {
  id: string;
  artifactId: string;
  status: 'succeeded' | 'failed';
  contentHash?: string | null;
  error?: string | null;
  createdAt: string;
}


export class EngineProjectClient extends EngineTransport {
  // --- Design Projects (v0.5) ---

  /**
   * Encode a project-relative file path for `/files/*` splat routes.
   * Rejects absolute paths, `..`, control chars; encodes each segment.
   */
  protected projectRelPathSegments(raw: unknown, maxChars = 1_000): string {
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
    let p = raw.trim().replace(/\\/g, '/');
    while (p.startsWith('./')) p = p.slice(2);
    p = p.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '');
    if (!p || p.length > maxChars) return '';
    if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return '';
    const segments = p.split('/');
    for (const seg of segments) {
      if (!seg || seg === '.' || seg === '..') return '';
    }
    return segments.map((s) => encodeURIComponent(s)).join('/');
  }

  async listProjects(): Promise<ApiResponse<DesignProject[]>> {
    const res = await fetch(`${this.baseUrl}/api/projects`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async getProject(id: string): Promise<ApiResponse<DesignProject>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  /**
   * Issue a single-use import token for a folder path (desktop folder import gate).
   */
  async createImportToken(
    path: string,
  ): Promise<ApiResponse<{ token: string; path: string; expiresAt: string; expiresInMs: number }>> {
    if (typeof path !== 'string' || /[\0\r\n]/.test(path) || !path.trim()) {
      return { ok: false, error: 'Invalid path' };
    }
    const res = await fetch(`${this.baseUrl}/api/projects/import-token`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ path: path.trim() }),
    });
    return readApiResponse(res);
  }

  async createProject(input: {
    name: string;
    baseDir?: string;
    /** Single-use token from createImportToken when setting baseDir. */
    importToken?: string;
    entryFile?: string | null;
    designSystemId?: string | null;
    meta?: Record<string, unknown>;
  }): Promise<ApiResponse<DesignProject>> {
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
      return { ok: false, error: 'Invalid name' };
    }
    if (input.baseDir != null && (typeof input.baseDir !== 'string' || /[\0\r\n]/.test(input.baseDir))) {
      return { ok: false, error: 'Invalid baseDir' };
    }
    if (
      input.importToken != null
      && (typeof input.importToken !== 'string' || /[\0\r\n]/.test(input.importToken))
    ) {
      return { ok: false, error: 'Invalid importToken' };
    }
    const res = await fetch(`${this.baseUrl}/api/projects`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        name: input.name.trim(),
        baseDir: input.baseDir?.trim() || undefined,
        importToken: input.importToken?.trim() || undefined,
        entryFile: input.entryFile,
        designSystemId: input.designSystemId,
        meta: input.meta,
      }),
    });
    return readApiResponse(res);
  }

  async updateProject(
    id: string,
    input: {
      name?: string;
      baseDir?: string;
      entryFile?: string | null;
      designSystemId?: string | null;
      meta?: Record<string, unknown>;
    },
  ): Promise<ApiResponse<DesignProject>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('project id');
    if (input.name != null && (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name))) {
      return { ok: false, error: 'Invalid name' };
    }
    if (input.baseDir != null && (typeof input.baseDir !== 'string' || /[\0\r\n]/.test(input.baseDir))) {
      return { ok: false, error: 'Invalid baseDir' };
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteProject(id: string): Promise<ApiResponse<null>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Download project as neos-project ZIP (v0.5.9). Returns blob on success. */
  async exportProjectZip(projectId: string): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
    const seg = this.pathSegment(projectId);
    if (!seg) return { ok: false, error: 'Invalid project id' };
    try {
      const res = await fetch(`${this.baseUrl}/api/projects/${seg}/export.zip`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
        const raw = errBody?.error || `HTTP ${res.status}`;
        return { ok: false, error: scrubApiErrorMessage(raw, 'Export failed') };
      }
      const blob = await res.blob();
      if (blob.size === 0) return { ok: false, error: 'Empty export' };
      return { ok: true, blob };
    } catch (err) {
      return {
        ok: false,
        error: scrubApiErrorMessage(
          err instanceof Error ? err.message : 'Export failed',
          'Export failed',
        ),
      };
    }
  }

  /** Import neos-project ZIP (raw body). */
  async importProjectZip(
    zip: Blob | ArrayBuffer,
  ): Promise<ApiResponse<{ project: DesignProject; filesImported: number }>> {
    try {
      const body = zip instanceof Blob ? zip : new Blob([zip], { type: 'application/zip' });
      // Auth only — do not send application/json Content-Type for binary ZIP body
      const headers = { ...this.getHeaders() };
      delete headers['Content-Type'];
      headers['Content-Type'] = 'application/zip';
      const res = await fetch(`${this.baseUrl}/api/projects/import.zip`, {
        method: 'POST',
        headers,
        body,
      });
      return readApiResponse(res);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Import failed' };
    }
  }

  async listProjectFiles(projectId: string): Promise<ApiResponse<ProjectFileEntry[]>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/files`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /**
   * Project collab presence SSE (v0.6.0 M0 + v0.7 M2 selection).
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
    const seg = this.pathSegment(projectId);
    if (!seg) return () => {};
    const qs =
      opts?.displayName && !/[\0\r\n]/.test(opts.displayName)
        ? `?name=${encodeURIComponent(opts.displayName.trim().slice(0, 48))}`
        : '';
    void (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/api/projects/${seg}/collab/stream${qs}`, {
          method: 'GET',
          headers: {
            ...this.getHeaders(),
            Accept: 'text/event-stream',
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
              eventName = parseSseEventName(line) || 'message';
            } else if (line.startsWith('data:')) {
              const data = parseSseDataPayload(line);
              if (!data) continue;
              try {
                const parsed = JSON.parse(data) as Record<string, unknown>;
                onEvent({
                  type: eventName,
                  projectId: typeof parsed.projectId === 'string' ? parsed.projectId : undefined,
                  sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
                  displayName:
                    typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
                  colorHint:
                    typeof parsed.colorHint === 'number' && Number.isFinite(parsed.colorHint)
                      ? parsed.colorHint
                      : undefined,
                  reason:
                    typeof parsed.reason === 'string' && !/[\0\r\n]/.test(parsed.reason)
                      ? parsed.reason
                      : undefined,
                  peers: Array.isArray(parsed.peers)
                    ? (parsed.peers as Array<{
                        sessionId: string;
                        displayName: string;
                        lastSeen?: string;
                      }>)
                    : undefined,
                  peer:
                    parsed.peer && typeof parsed.peer === 'object'
                      ? (parsed.peer as {
                          sessionId: string;
                          displayName: string;
                          lastSeen?: string;
                        })
                      : undefined,
                  self:
                    parsed.self && typeof parsed.self === 'object'
                      ? (parsed.self as {
                          sessionId: string;
                          displayName: string;
                          lastSeen?: string;
                        })
                      : undefined,
                  locks: Array.isArray(parsed.locks)
                    ? (parsed.locks as Array<{
                        path: string;
                        sessionId: string;
                        displayName: string;
                      }>)
                    : undefined,
                  lock:
                    parsed.lock && typeof parsed.lock === 'object'
                      ? (parsed.lock as {
                          path: string;
                          sessionId: string;
                          displayName: string;
                        })
                      : undefined,
                  path: typeof parsed.path === 'string' ? parsed.path : undefined,
                  selections: Array.isArray(parsed.selections)
                    ? (parsed.selections as Array<{
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
                    parsed.selection && typeof parsed.selection === 'object'
                      ? (parsed.selection as {
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
        // aborted
      }
    })();
    return () => controller.abort();
  }

  async collabLock(
    projectId: string,
    body: { sessionId: string; path: string; action: 'acquire' | 'release' },
  ): Promise<
    ApiResponse<{
      lock?: {
        path: string;
        sessionId: string;
        displayName: string;
        acquiredAt?: string;
      };
      released?: boolean;
      path?: string;
      holder?: { sessionId: string; displayName: string; path?: string; acquiredAt?: string };
    }>
  > {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/collab/locks`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    const envelope = await readApiResponse<{
      lock?: {
        path: string;
        sessionId: string;
        displayName: string;
        acquiredAt?: string;
      };
      released?: boolean;
      path?: string;
      holder?: { sessionId: string; displayName: string; path?: string; acquiredAt?: string };
    }>(res);
    if (envelope.ok) {
      const checked = parseCollabLockSuccess(envelope);
      if (!checked.ok) {
        return { ok: false, error: checked.error };
      }
      return { ok: true, data: checked.data.data };
    }
    // 409 conflict: preserve holder via shared schema when possible
    const conflict = parseCollabLockConflict(envelope);
    if (conflict.ok) {
      return {
        ok: false,
        error: conflict.data.error ?? envelope.error,
        data: conflict.data.data,
      };
    }
    return envelope;
  }

  /** Snapshot of collab peers (REST helper). */
  async listCollabPeers(
    projectId: string,
  ): Promise<
    ApiResponse<{
      peers: Array<{
        sessionId: string;
        displayName: string;
        colorHint?: number;
        joinedAt?: string;
        lastSeen?: string;
      }>;
    }>
  > {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/collab/peers`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Snapshot of advisory file locks. */
  async listCollabLocks(
    projectId: string,
  ): Promise<
    ApiResponse<{
      locks: Array<{ path: string; sessionId: string; displayName: string; acquiredAt?: string }>;
      hardEnforce?: boolean;
      agentsHardEnforce?: boolean;
    }>
  > {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/collab/locks`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Snapshot of peer selections. */
  async listCollabSelections(
    projectId: string,
  ): Promise<
    ApiResponse<{
      selections: Array<{
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
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/collab/selections`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Keep idle sweep from dropping a session if SSE stalls. */
  async collabHeartbeat(
    projectId: string,
    body: { sessionId: string; displayName?: string },
  ): Promise<ApiResponse<{ touched?: boolean }>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/collab/heartbeat`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  /**
   * GET /api/collab/status — bus + presence/lock registry + shared-edit flags (ops, no secrets).
   */
  async getCollabStatus(): Promise<
    ApiResponse<{
      bus?: string;
      nodeId?: string;
      ready?: boolean;
      detail?: string | null;
      presence?: { kind?: string; ready?: boolean; detail?: string | null };
      locks?: { kind?: string; ready?: boolean; detail?: string | null };
      sharedEdit?: { hardEnforce?: boolean; agentsHardEnforce?: boolean };
    }>
  > {
    const res = await fetch(`${this.baseUrl}/api/collab/status`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Publish editing selection for peer awareness (v0.7 M2). */
  async collabSelection(
    projectId: string,
    body: {
      sessionId: string;
      path?: string | null;
      selector?: string | null;
      layerId?: string | null;
      selectors?: string[] | null;
      layerIds?: string[] | null;
    },
  ): Promise<ApiResponse<{ selection?: unknown }>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/collab/selection`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  /**
   * Project file SSE (`file.changed` / `file.created` / `file.deleted`).
   * Returns abort callback. Uses fetch + Bearer (not EventSource).
   */
  streamProjectFileEvents(
    projectId: string,
    onEvent: (event: ProjectFileEventPayload & { type: string }) => void,
  ): () => void {
    const controller = new AbortController();
    const seg = this.pathSegment(projectId);
    if (!seg) return () => {};
    void (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/api/projects/${seg}/events/stream`, {
          method: 'GET',
          headers: {
            ...this.getHeaders(),
            Accept: 'text/event-stream',
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
              eventName = parseSseEventName(line) || 'message';
            } else if (line.startsWith('data:')) {
              const data = parseSseDataPayload(line);
              if (!data) continue;
              try {
                const parsed = JSON.parse(data) as Record<string, unknown>;
                onEvent({
                  type: eventName,
                  projectId: typeof parsed.projectId === 'string' ? parsed.projectId : undefined,
                  path: typeof parsed.path === 'string' ? parsed.path : undefined,
                  source: typeof parsed.source === 'string' ? parsed.source : undefined,
                  hash: typeof parsed.hash === 'string' ? parsed.hash : undefined,
                  ts: typeof parsed.ts === 'string' ? parsed.ts : undefined,
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
        // aborted / network
      }
    })();
    return () => controller.abort();
  }

  async readProjectFile(
    projectId: string,
    filePath: string,
  ): Promise<ApiResponse<ProjectFileContent>> {
    const seg = this.pathSegment(projectId);
    const pathSeg = this.projectRelPathSegments(filePath);
    if (!seg) return this.invalidIdResponse('project id');
    if (!pathSeg) return this.invalidIdResponse('file path');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/files/${pathSeg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async writeProjectFile(
    projectId: string,
    filePath: string,
    content: string,
    source: 'user' | 'agent' | 'import' | 'restore' = 'user',
    /**
     * Collab presence session id. Required for `NEOS_SHARED_EDIT` hard enforce
     * so the lock holder can write their own locked file (body + x-neos-session-id).
     */
    opts?: { sessionId?: string },
  ): Promise<ApiResponse<ProjectFileWriteResult>> {
    const seg = this.pathSegment(projectId);
    const pathSeg = this.projectRelPathSegments(filePath);
    if (!seg) return this.invalidIdResponse('project id');
    if (!pathSeg) return this.invalidIdResponse('file path');
    if (typeof content !== 'string' || /\0/.test(content)) {
      return { ok: false, error: 'Invalid content' };
    }
    const sessionId =
      opts?.sessionId != null
      && typeof opts.sessionId === 'string'
      && !/[\0\r\n]/.test(opts.sessionId)
        ? opts.sessionId.trim()
        : '';
    const headers = this.getHeaders();
    if (sessionId) {
      headers['x-neos-session-id'] = sessionId;
    }
    const body: { content: string; source: string; sessionId?: string } = {
      content,
      source,
    };
    if (sessionId) body.sessionId = sessionId;
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/files/${pathSeg}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });
    const envelope = await readApiResponse<ProjectFileWriteResult>(res);
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

  async deleteProjectFile(
    projectId: string,
    filePath: string,
    /** Collab session for `NEOS_SHARED_EDIT` hard enforce when path is locked. */
    opts?: { sessionId?: string },
  ): Promise<ApiResponse<{ path?: string; holder?: unknown }>> {
    const seg = this.pathSegment(projectId);
    const pathSeg = this.projectRelPathSegments(filePath);
    if (!seg) return this.invalidIdResponse('project id');
    if (!pathSeg) return this.invalidIdResponse('file path');
    const sessionId =
      opts?.sessionId != null
      && typeof opts.sessionId === 'string'
      && !/[\0\r\n]/.test(opts.sessionId)
        ? opts.sessionId.trim()
        : '';
    const headers = this.getHeaders();
    if (sessionId) {
      headers['x-neos-session-id'] = sessionId;
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/files/${pathSeg}`, {
      method: 'DELETE',
      headers,
      body: sessionId ? JSON.stringify({ sessionId }) : undefined,
    });
    return readApiResponse(res);
  }

  async mkdirProjectPath(
    projectId: string,
    dirPath: string,
    /** Collab session for `NEOS_SHARED_EDIT` hard enforce when path is locked. */
    opts?: { sessionId?: string },
  ): Promise<ApiResponse<{ path: string; holder?: unknown }>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    if (typeof dirPath !== 'string' || /[\0\r\n]/.test(dirPath) || !dirPath.trim()) {
      return this.invalidIdResponse('path');
    }
    const sessionId =
      opts?.sessionId != null
      && typeof opts.sessionId === 'string'
      && !/[\0\r\n]/.test(opts.sessionId)
        ? opts.sessionId.trim()
        : '';
    const headers = this.getHeaders();
    if (sessionId) {
      headers['x-neos-session-id'] = sessionId;
    }
    const body: { path: string; sessionId?: string } = { path: dirPath.trim() };
    if (sessionId) body.sessionId = sessionId;
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/mkdir`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  async listProjectRevisions(
    projectId: string,
    filePath?: string,
  ): Promise<ApiResponse<ProjectFileRevision[]>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    let qs = '';
    if (filePath != null && filePath !== '') {
      if (typeof filePath !== 'string' || /[\0\r\n]/.test(filePath)) {
        return this.invalidIdResponse('file path');
      }
      qs = `?path=${encodeURIComponent(filePath.trim())}`;
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/revisions${qs}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** GET /api/projects/:id/revisions/:revisionId — includes content snapshot. */
  async getProjectRevision(
    projectId: string,
    revisionId: string,
  ): Promise<ApiResponse<ProjectFileRevision>> {
    const pSeg = this.pathSegment(projectId);
    const rSeg = this.pathSegment(revisionId);
    if (!pSeg) return this.invalidIdResponse('project id');
    if (!rSeg) return this.invalidIdResponse('revision id');
    const res = await fetch(`${this.baseUrl}/api/projects/${pSeg}/revisions/${rSeg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async restoreProjectRevision(
    projectId: string,
    revisionId: string,
    /**
     * Collab presence session id. Required under `NEOS_SHARED_EDIT` hard enforce
     * when the target path is locked (body + x-neos-session-id).
     */
    opts?: { sessionId?: string },
  ): Promise<ApiResponse<{ path: string; hash: string }>> {
    const pSeg = this.pathSegment(projectId);
    const rSeg = this.pathSegment(revisionId);
    if (!pSeg) return this.invalidIdResponse('project id');
    if (!rSeg) return this.invalidIdResponse('revision id');
    const sessionId =
      opts?.sessionId != null
      && typeof opts.sessionId === 'string'
      && !/[\0\r\n]/.test(opts.sessionId)
        ? opts.sessionId.trim()
        : '';
    const headers = this.getHeaders();
    if (sessionId) {
      headers['x-neos-session-id'] = sessionId;
    }
    const res = await fetch(
      `${this.baseUrl}/api/projects/${pSeg}/revisions/${rSeg}/restore`,
      {
        method: 'POST',
        headers,
        body: sessionId ? JSON.stringify({ sessionId }) : undefined,
      },
    );
    return readApiResponse(res);
  }

  async listProjectPreviewComments(
    projectId: string,
    filePath?: string,
  ): Promise<ApiResponse<ProjectPreviewComment[]>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    let qs = '';
    if (filePath != null && filePath !== '') {
      if (typeof filePath !== 'string' || /[\0\r\n]/.test(filePath)) {
        return this.invalidIdResponse('file path');
      }
      qs = `?path=${encodeURIComponent(filePath.trim())}`;
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/preview-comments${qs}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async createProjectPreviewComment(
    projectId: string,
    input: { filePath: string; selector: string; body: string },
  ): Promise<ApiResponse<ProjectPreviewComment>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    if (
      typeof input.filePath !== 'string'
      || typeof input.selector !== 'string'
      || typeof input.body !== 'string'
      || /[\0\r\n]/.test(input.filePath)
      || /[\0\r\n]/.test(input.selector)
      || /\0/.test(input.body)
    ) {
      return { ok: false, error: 'Invalid comment fields' };
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/preview-comments`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: input.filePath.trim(),
        selector: input.selector.trim(),
        body: input.body.trim(),
      }),
    });
    return readApiResponse(res);
  }

  async deleteProjectPreviewComment(
    projectId: string,
    commentId: string,
  ): Promise<ApiResponse<void>> {
    const pSeg = this.pathSegment(projectId);
    const cSeg = this.pathSegment(commentId);
    if (!pSeg) return this.invalidIdResponse('project id');
    if (!cSeg) return this.invalidIdResponse('comment id');
    const res = await fetch(
      `${this.baseUrl}/api/projects/${pSeg}/preview-comments/${cSeg}`,
      { method: 'DELETE', headers: this.getHeaders() },
    );
    return readApiResponse(res);
  }

  // --- Project conversations / messages ---

  async listProjectConversations(
    projectId: string,
  ): Promise<ApiResponse<ProjectConversation[]>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/conversations`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async createProjectConversation(
    projectId: string,
    title?: string,
  ): Promise<ApiResponse<ProjectConversation>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const body: { title?: string } = {};
    if (typeof title === 'string' && !/[\0\r\n]/.test(title) && title.trim()) {
      body.title = title.trim().slice(0, 200);
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/conversations`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  async listProjectMessages(
    projectId: string,
    conversationId: string,
  ): Promise<ApiResponse<ProjectMessage[]>> {
    const pSeg = this.pathSegment(projectId);
    const cSeg = this.pathSegment(conversationId);
    if (!pSeg) return this.invalidIdResponse('project id');
    if (!cSeg) return this.invalidIdResponse('conversation id');
    const res = await fetch(
      `${this.baseUrl}/api/projects/${pSeg}/conversations/${cSeg}/messages`,
      { headers: this.getHeaders() },
    );
    return readApiResponse(res);
  }

  async addProjectMessage(
    projectId: string,
    conversationId: string,
    input: { role?: 'user' | 'assistant' | 'system'; content: string; agentId?: string },
  ): Promise<ApiResponse<ProjectMessage>> {
    const pSeg = this.pathSegment(projectId);
    const cSeg = this.pathSegment(conversationId);
    if (!pSeg) return this.invalidIdResponse('project id');
    if (!cSeg) return this.invalidIdResponse('conversation id');
    if (typeof input.content !== 'string' || /\0/.test(input.content) || !input.content.trim()) {
      return { ok: false, error: 'Invalid content' };
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
    const res = await fetch(
      `${this.baseUrl}/api/projects/${pSeg}/conversations/${cSeg}/messages`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      },
    );
    return readApiResponse(res);
  }

  async createProjectRun(input: {
    projectId?: string;
    agentId?: string | null;
    prompt: string;
    editContext?: unknown;
    dryRun?: boolean;
    execute?: boolean;
    /** Collab presence session bind for agent lock identity (v0.11 M0). */
    sessionId?: string | null;
  }): Promise<ApiResponse<ProjectRunSummary>> {
    if (typeof input.prompt !== 'string' || /\0/.test(input.prompt)) {
      return { ok: false, error: 'Invalid prompt' };
    }
    if (input.prompt.length > 100_000) {
      return { ok: false, error: 'prompt exceeds max length (100000)' };
    }
    if (
      input.projectId != null
      && input.projectId !== ''
      && (typeof input.projectId !== 'string' || /[\0\r\n]/.test(input.projectId))
    ) {
      return this.invalidIdResponse('project id');
    }
    if (
      input.agentId != null
      && input.agentId !== ''
      && (typeof input.agentId !== 'string' || /[\0\r\n]/.test(input.agentId))
    ) {
      return { ok: false, error: 'Invalid agentId' };
    }
    let sessionId: string | undefined;
    if (input.sessionId != null && input.sessionId !== '') {
      if (typeof input.sessionId !== 'string' || /[\0\r\n]/.test(input.sessionId)) {
        return { ok: false, error: 'Invalid sessionId' };
      }
      const s = input.sessionId.trim();
      if (!s || s.length > 64) return { ok: false, error: 'Invalid sessionId' };
      sessionId = s;
    }
    const body: Record<string, unknown> = {
      prompt: input.prompt,
    };
    if (input.projectId) body.projectId = input.projectId.trim();
    if (input.agentId) body.agentId = input.agentId.trim();
    if (input.editContext != null) body.editContext = input.editContext;
    if (input.dryRun === true) body.dryRun = true;
    if (input.execute === false) body.execute = false;
    if (sessionId) body.sessionId = sessionId;

    const headers = this.getHeaders();
    if (sessionId) {
      headers['x-neos-session-id'] = sessionId;
    }

    const res = await fetch(`${this.baseUrl}/api/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  async getProjectRun(runId: string): Promise<ApiResponse<ProjectRunSummary>> {
    const seg = this.pathSegment(runId);
    if (!seg) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/runs/${seg}`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async listProjectRunEvents(
    runId: string,
    after?: string,
  ): Promise<ApiResponse<ProjectRunEvent[]>> {
    const seg = this.pathSegment(runId);
    if (!seg) return this.invalidIdResponse('run id');
    let qs = '';
    if (after) {
      const a = this.pathSegment(after);
      if (a) qs = `?after=${a}`;
    }
    const res = await fetch(`${this.baseUrl}/api/runs/${seg}/events${qs}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /**
   * Project run SSE (`run.stdout` / `run.succeeded` / `run.failed` / …).
   * GET /api/runs/:id/events/stream — ends when run is terminal or after 10 min.
   * Returns abort callback. Uses fetch + Bearer (not EventSource).
   */
  streamProjectRunEvents(
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
    const seg = this.pathSegment(runId);
    if (!seg) {
      queueMicrotask(() => opts?.onError?.(new Error('Invalid run id')));
      return () => {};
    }
    void (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/api/runs/${seg}/events/stream`, {
          method: 'GET',
          headers: {
            ...this.getHeaders(),
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          if (!controller.signal.aborted) {
            opts?.onError?.(
              new Error(formatHttpErrorMessage(res.status, res.statusText)),
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
              eventName = parseSseEventName(line) || 'message';
            } else if (line.startsWith('data:')) {
              const data = parseSseDataPayload(line);
              if (!data) continue;
              try {
                const parsed = JSON.parse(data) as Record<string, unknown>;
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
            } else if (line === '') {
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

  async cancelProjectRun(runId: string): Promise<ApiResponse<ProjectRunSummary>> {
    const seg = this.pathSegment(runId);
    if (!seg) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/runs/${seg}/cancel`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

}
