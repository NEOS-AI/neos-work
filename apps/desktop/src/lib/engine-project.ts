/**
 * Design Project + collab API surface on the desktop engine client.
 * v0.12 M0: extracted from engine.ts (EngineClient extends this).
 * v0.20 Track D: leaf of Core → Collab → Files → ProjectClient chain
 * (conversations + project runs). Intermediate classes re-exported for deep imports.
 */

import {
  type ApiResponse,
  type ProjectRunEvent,
  type ProjectRunSummary,
} from '@neos-work/shared';
import {
  formatHttpErrorMessage,
  parseSseDataPayload,
  parseSseEventName,
  readApiResponse,
} from './engine-transport.js';
import { EngineProjectFilesClient } from './engine-project-files.js';
import type {
  ProjectConversation,
  ProjectMessage,
} from './engine-project-core.js';

export {
  EngineProjectCoreClient,
  type DesignProject,
  type ProjectFileEntry,
  type ProjectFileRevision,
  type ProjectPreviewComment,
  type ProjectConversation,
  type ProjectMessage,
  type PluginChannel,
  type Plugin,
  type PluginListMeta,
  type Artifact,
  type Routine,
  type MediaFileInfo,
  type LiveArtifact,
  type LiveArtifactRefresh,
} from './engine-project-core.js';
export { EngineProjectCollabClient } from './engine-project-collab.js';
export { EngineProjectFilesClient } from './engine-project-files.js';

export class EngineProjectClient extends EngineProjectFilesClient {
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
