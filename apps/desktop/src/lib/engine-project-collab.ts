/**
 * Design Project collab / presence / file-events API surface.
 * v0.20 Track D: extends EngineProjectCoreClient.
 */

import {
  parseCollabLockConflict,
  parseCollabLockSuccess,
  type ApiResponse,
  type ProjectFileEventPayload,
} from '@neos-work/shared';
import {
  parseSseDataPayload,
  parseSseEventName,
  readApiResponse,
} from './engine-transport.js';
import { EngineProjectCoreClient } from './engine-project-core.js';

export class EngineProjectCollabClient extends EngineProjectCoreClient {
  // --- Project collab (v0.6+) ---


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
}
