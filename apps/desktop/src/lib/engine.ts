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

export class EngineClient {
  private baseUrl: string;
  private apiKeys: { anthropic?: string; google?: string } = {};

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  get url(): string {
    return this.baseUrl;
  }

  setApiKeys(keys: { anthropic?: string; google?: string }): void {
    this.apiKeys = keys;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKeys.anthropic) headers['x-anthropic-key'] = this.apiKeys.anthropic;
    if (this.apiKeys.google) headers['x-google-key'] = this.apiKeys.google;
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
    const res = await fetch(`${this.baseUrl}/api/session${qs}`);
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
    const res = await fetch(`${this.baseUrl}/api/session/${id}`, { method: 'DELETE' });
    return res.json();
  }

  // --- Messages ---

  async listMessages(sessionId: string): Promise<ApiResponse<MessageData[]>> {
    const res = await fetch(`${this.baseUrl}/api/session/${sessionId}/messages`);
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

  // --- Workspaces ---

  async listWorkspaces(): Promise<ApiResponse<{ id: string; name: string; path?: string; type: string }[]>> {
    const res = await fetch(`${this.baseUrl}/api/workspace`);
    return res.json();
  }

  async createWorkspace(params: {
    name: string;
    path?: string;
    type?: string;
  }): Promise<ApiResponse<{ id: string; name: string; type: string }>> {
    const res = await fetch(`${this.baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async deleteWorkspace(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/workspace/${id}`, { method: 'DELETE' });
    return res.json();
  }

  // --- Settings ---

  async getSettings(): Promise<ApiResponse<Record<string, string>>> {
    const res = await fetch(`${this.baseUrl}/api/settings`);
    return res.json();
  }

  async getSetting(key: string): Promise<ApiResponse<{ key: string; value: string }>> {
    const res = await fetch(`${this.baseUrl}/api/settings/${encodeURIComponent(key)}`);
    return res.json();
  }

  async saveSetting(key: string, value: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    return res.json();
  }

  async verifyApiKey(provider: string, key: string): Promise<ApiResponse<{ valid: boolean }>> {
    const res = await fetch(`${this.baseUrl}/api/settings/verify-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key }),
    });
    return res.json();
  }

  /** Load API keys from server settings and set them on this client. */
  async loadApiKeys(): Promise<void> {
    try {
      const res = await this.getSettings();
      if (res.ok && res.data) {
        this.setApiKeys({
          anthropic: res.data['apiKey.anthropic'] || undefined,
          google: res.data['apiKey.google'] || undefined,
        });
      }
    } catch {
      // Settings might not be available yet
    }
  }

  // --- Models ---

  async listModels(): Promise<ApiResponse<{ id: string; name: string; providerId: string }[]>> {
    const res = await fetch(`${this.baseUrl}/api/models`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }
}
