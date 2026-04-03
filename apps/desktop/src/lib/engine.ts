/**
 * Engine client — communicates with the NEOS Work engine server.
 */

import type { ApiResponse, ChatChunk, HealthResponse } from '@neos-work/shared';

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

export interface McpServerData {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command: string | null;
  args: string[] | null;
  url: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface SkillData {
  id: string;
  name: string;
  description: string | null;
  source: string;
  path: string;
  version: string | null;
  enabled: boolean;
  installedAt: string;
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

export class EngineClient {
  private baseUrl: string;
  private authToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  get url(): string {
    return this.baseUrl;
  }

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  // --- Health ---

  async health(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/api/health`);
    return res.json();
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
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
    const res = await fetch(`${this.baseUrl}/api/session${qs}`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async createSession(params: {
    workspaceId: string;
    title?: string;
    provider?: string;
    model?: string;
    thinkingMode?: string;
  }): Promise<ApiResponse<SessionData>> {
    const res = await fetch(`${this.baseUrl}/api/session`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async deleteSession(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/session/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- Messages ---

  async listMessages(sessionId: string): Promise<ApiResponse<MessageData[]>> {
    const res = await fetch(`${this.baseUrl}/api/session/${sessionId}/messages`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- Chat (SSE) ---

  async *chat(
    sessionId: string,
    content: string,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatChunk> {
    const res = await fetch(`${this.baseUrl}/api/session/${sessionId}/chat`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ content }),
      signal,
    });

    if (!res.ok || !res.body) {
      yield { type: 'error', content: `HTTP ${res.status}: ${res.statusText}` };
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
          const data = line.slice(5).trim();
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
    const res = await fetch(`${this.baseUrl}/api/session/${sessionId}/agent`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ content }),
      signal,
    });

    if (!res.ok || !res.body) {
      yield { type: 'error', error: `HTTP ${res.status}: ${res.statusText}` };
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
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
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
    const res = await fetch(`${this.baseUrl}/api/session/${sessionId}/cancel`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- Tool Confirmation (VULN-003) ---

  async confirmTool(
    sessionId: string,
    toolUseId: string,
    approved: boolean,
  ): Promise<ApiResponse<void>> {
    const res = await fetch(
      `${this.baseUrl}/api/session/${sessionId}/tool-confirm/${toolUseId}`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ approved }),
      },
    );
    return res.json();
  }

  // --- Workspaces ---

  async listWorkspaces(): Promise<ApiResponse<{ id: string; name: string; path?: string; type: string }[]>> {
    const res = await fetch(`${this.baseUrl}/api/workspace`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async createWorkspace(params: {
    name: string;
    path?: string;
    type?: string;
  }): Promise<ApiResponse<{ id: string; name: string; type: string }>> {
    const res = await fetch(`${this.baseUrl}/api/workspace`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async updateWorkspace(
    id: string,
    params: { name?: string; path?: string },
  ): Promise<ApiResponse<{ id: string; name: string; type: string }>> {
    const res = await fetch(`${this.baseUrl}/api/workspace/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async deleteWorkspace(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/workspace/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- Settings ---

  async getSettings(): Promise<ApiResponse<Record<string, string>>> {
    const res = await fetch(`${this.baseUrl}/api/settings`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async getSetting(key: string): Promise<ApiResponse<{ key: string; value: string }>> {
    const res = await fetch(`${this.baseUrl}/api/settings/${encodeURIComponent(key)}`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async saveSetting(key: string, value: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ value }),
    });
    return res.json();
  }

  async verifyApiKey(provider: string, key: string): Promise<ApiResponse<{ valid: boolean }>> {
    const res = await fetch(`${this.baseUrl}/api/settings/verify-key`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ provider, key }),
    });
    return res.json();
  }

  // --- Models ---

  async listModels(): Promise<ApiResponse<{ id: string; name: string; providerId: string }[]>> {
    const res = await fetch(`${this.baseUrl}/api/models`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- Skills ---

  async listSkills(): Promise<ApiResponse<SkillData[]>> {
    const res = await fetch(`${this.baseUrl}/api/skills`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async scanSkills(): Promise<ApiResponse<{ scanned: number; total: number }>> {
    const res = await fetch(`${this.baseUrl}/api/skills/scan`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async toggleSkill(id: string, enabled: boolean): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/skills/${id}/toggle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ enabled }),
    });
    return res.json();
  }

  async deleteSkill(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/skills/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- MCP Servers ---

  async listMcpServers(): Promise<ApiResponse<McpServerData[]>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async createMcpServer(params: {
    name: string;
    transport: 'stdio' | 'http';
    command?: string;
    args?: string[];
    url?: string;
  }): Promise<ApiResponse<McpServerData>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async toggleMcpServer(id: string, enabled: boolean): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/${id}/toggle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ enabled }),
    });
    return res.json();
  }

  async deleteMcpServer(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }
}
