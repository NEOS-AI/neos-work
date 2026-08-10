/**
 * Sessions / chat / agent / workspaces API surface on the desktop engine client.
 * v0.18 Track M0: extracted from engine.ts (EnginePluginsClient / EngineClient extend this).
 */

import {
  type ApiResponse,
  type ChatChunk,
  type HealthResponse,
} from '@neos-work/shared';
import { EngineMediaClient } from './engine-media.js';
import {
  formatHttpErrorMessage,
  parseSseDataPayload,
  parseSseEventName,
  readApiResponse,
  readHealthResponse,
} from './engine-transport.js';

export interface SessionData {
  id: string;
  workspace_id: string;
  title: string | null;
  provider: string;
  model: string;
  thinking_mode: string;
  created_at: string;
  updated_at: string;
}

export interface MessageData {
  id: string;
  session_id: string;
  role: string;
  content: string;
  metadata: string | null;
  created_at: string;
}

export interface AgentStep {
  id: string;
  index: number;
  description: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  toolName?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  screenshot?: string;    // base64 PNG (browser_screenshot 결과)
  healingStatus?: string; // healing 진행 중 텍스트
}

export interface AgentTask {
  id: string;
  goal: string;
  steps: AgentStep[];
  status: string;
  createdAt: string;
  completedAt?: string;
}

export type AgentChunk =
  | { type: 'plan'; steps: AgentStep[] }
  | { type: 'step_start'; step: AgentStep }
  | { type: 'step_complete'; step: AgentStep }
  | { type: 'step_error'; step: AgentStep; error: string }
  | { type: 'step_healing'; step: AgentStep; strategy: 'retry' | 'reflect' }
  | { type: 'text'; content: string }
  | { type: 'done'; task: AgentTask }
  | { type: 'error'; error: string };

export class EngineSessionsClient extends EngineMediaClient {
  // --- Health ---

  async health(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/api/health`);
    return readHealthResponse(res);
  }

  async checkConnection(): Promise<boolean> {
    try {
      const health = await this.health();
      return health.status === 'ok';
    } catch {
      return false;
    }
  }

  // --- Sessions ---

  async listSessions(workspaceId?: string): Promise<ApiResponse<SessionData[]>> {
    let qs = '';
    if (workspaceId != null && workspaceId !== '') {
      const seg = this.pathSegment(workspaceId);
      if (!seg) return this.invalidIdResponse('workspace id');
      qs = `?workspaceId=${seg}`;
    }
    const res = await fetch(`${this.baseUrl}/api/session${qs}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async createSession(params: {
    workspaceId: string;
    title?: string;
    provider?: string;
    model?: string;
    thinkingMode?: string;
  }): Promise<ApiResponse<SessionData>> {
    const workspaceId = this.sanitizeId(params.workspaceId);
    if (!workspaceId) return this.invalidIdResponse('workspace id');
    const res = await fetch(`${this.baseUrl}/api/session`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ ...params, workspaceId }),
    });
    return readApiResponse(res);
  }

  async deleteSession(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('session id');
    const res = await fetch(`${this.baseUrl}/api/session/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Messages ---

  async listMessages(sessionId: string): Promise<ApiResponse<MessageData[]>> {
    const seg = this.pathSegment(sessionId);
    if (!seg) return this.invalidIdResponse('session id');
    const res = await fetch(`${this.baseUrl}/api/session/${seg}/messages`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Chat (SSE) ---

  async *chat(
    sessionId: string,
    content: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatChunk> {
    const seg = this.pathSegment(sessionId);
    if (!seg) {
      yield { type: 'error', content: 'Invalid session id' };
      return;
    }
    const res = await fetch(`${this.baseUrl}/api/session/${seg}/chat`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ content }),
      signal,
    });

    if (!res.ok || !res.body) {
      yield { type: 'error', content: formatHttpErrorMessage(res.status, res.statusText) };
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
        if (line.startsWith('data:')) {
          const data = parseSseDataPayload(line);
          if (!data) continue;
          try {
            yield JSON.parse(data) as ChatChunk;
          } catch {
            // skip malformed JSON
          }
        }
      }
    }
  }

  // --- Agent execution (SSE) ---

  async *runAgent(
    sessionId: string,
    content: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentChunk> {
    const sid = this.pathSegment(sessionId);
    if (!sid) {
      yield { type: 'error', error: 'Invalid session id' };
      return;
    }
    const res = await fetch(`${this.baseUrl}/api/session/${sid}/agent`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ content }),
      signal,
    });

    if (!res.ok || !res.body) {
      yield { type: 'error', error: formatHttpErrorMessage(res.status, res.statusText) };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = parseSseEventName(line);
        } else if (line.startsWith('data:')) {
          const data = parseSseDataPayload(line);
          if (!data || !currentEvent) continue;
          try {
            const parsed = JSON.parse(data);
            yield { type: currentEvent, ...parsed } as AgentChunk;
          } catch {
            // skip malformed JSON
          }
          currentEvent = '';
        }
      }
    }
  }

  // --- Cancel active chat ---

  async cancelSession(sessionId: string): Promise<ApiResponse<void>> {
    const sid = this.pathSegment(sessionId);
    if (!sid) return this.invalidIdResponse('session id');
    const res = await fetch(`${this.baseUrl}/api/session/${sid}/cancel`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Tool Confirmation (VULN-003) ---

  async confirmTool(
    sessionId: string,
    toolUseId: string,
    approved: boolean,
  ): Promise<ApiResponse<void>> {
    const sid = this.pathSegment(sessionId);
    if (!sid) return this.invalidIdResponse('session id');
    const tid = this.pathSegment(toolUseId);
    if (!tid) return this.invalidIdResponse('tool use id');
    const res = await fetch(
      `${this.baseUrl}/api/session/${sid}/tool-confirm/${tid}`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ approved }),
      },
    );
    return readApiResponse(res);
  }

  // --- Workspaces ---

  async listWorkspaces(): Promise<ApiResponse<{ id: string; name: string; path?: string; type: string }[]>> {
    const res = await fetch(`${this.baseUrl}/api/workspace`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async createWorkspace(params: {
    name: string;
    path?: string;
    type?: string;
  }): Promise<ApiResponse<{ id: string; name: string; path?: string | null; type: string }>> {
    const nameRaw = typeof params.name === 'string' ? params.name : '';
    if (/[\0\r\n]/.test(nameRaw) || !nameRaw.trim() || nameRaw.trim().length > 200) {
      return { ok: false, error: 'Invalid workspace name' };
    }
    const body: { name: string; path?: string; type?: string } = {
      name: nameRaw.trim(),
    };
    if (
      params.path != null
      && typeof params.path === 'string'
      && !/[\0\r\n]/.test(params.path)
      && params.path.trim()
    ) {
      body.path = params.path.trim();
    }
    if (
      params.type != null
      && typeof params.type === 'string'
      && !/[\0\r\n]/.test(params.type)
      && params.type.trim()
    ) {
      body.type = params.type.trim();
    }
    const res = await fetch(`${this.baseUrl}/api/workspace`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  async updateWorkspace(
    id: string,
    params: { name?: string; path?: string },
  ): Promise<ApiResponse<{ id: string; name: string; path?: string | null; type: string }>> {
    const wid = this.pathSegment(id);
    if (!wid) return this.invalidIdResponse('workspace id');
    const body: { name?: string; path?: string } = {};
    if (params.name !== undefined) {
      const nameRaw = typeof params.name === 'string' ? params.name : '';
      if (/[\0\r\n]/.test(nameRaw) || !nameRaw.trim() || nameRaw.trim().length > 200) {
        return { ok: false, error: 'Invalid workspace name' };
      }
      body.name = nameRaw.trim();
    }
    if (params.path !== undefined) {
      if (typeof params.path !== 'string' || /[\0\r\n]/.test(params.path) || !params.path.trim()) {
        return { ok: false, error: 'Invalid workspace path' };
      }
      body.path = params.path.trim();
    }
    if (body.name === undefined && body.path === undefined) {
      return { ok: false, error: 'Nothing to update' };
    }
    const res = await fetch(`${this.baseUrl}/api/workspace/${wid}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  /** Cannot delete the seeded `default` workspace (server enforces). */
  async deleteWorkspace(id: string): Promise<ApiResponse<void>> {
    const wid = this.pathSegment(id);
    if (!wid) return this.invalidIdResponse('workspace id');
    if (wid === 'default') {
      return { ok: false, error: 'Cannot delete default workspace' };
    }
    const res = await fetch(`${this.baseUrl}/api/workspace/${wid}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- CLI Agents ---

  async listCliAgents(): Promise<ApiResponse<{ id: string; name: string; path: string; version?: string }[]>> {
    const res = await fetch(`${this.baseUrl}/api/cli-agents`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }
}
