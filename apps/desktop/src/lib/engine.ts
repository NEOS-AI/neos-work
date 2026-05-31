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

export interface DesignSystem {
  id: string;
  name: string;
  description?: string;
  path: string;
  hasManifest: boolean;
  hasTokens: boolean;
  hasComponents: boolean;
  createdAt: string;
  updatedAt: string;
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
  enabled: boolean;
  inputs: Record<string, unknown>;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineRun {
  id: string;
  routineId: string;
  runId?: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
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
  mode?: string;
  category?: string;
  featured?: boolean;
  triggers?: string[];
  examplePrompt?: string;
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

  // --- MCP OAuth ---

  async startMcpOAuth(params: {
    serverId: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    clientId: string;
    redirectUri: string;
    scope?: string;
  }): Promise<ApiResponse<{ authUrl: string; state: string }>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/oauth/start`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async getMcpOAuthStatus(serverId: string): Promise<ApiResponse<{ connected: boolean; expiresAt?: string; scope?: string }>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/oauth/${serverId}/status`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async revokeMcpOAuth(serverId: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/oauth/${serverId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async refreshMcpOAuth(serverId: string, params: { tokenEndpoint: string; clientId: string }): Promise<ApiResponse<{ connected: boolean; expiresAt?: string }>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/oauth/${serverId}/refresh`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    return res.json();
  }

  // --- CLI Agents ---

  async listCliAgents(): Promise<ApiResponse<{ id: string; name: string; path: string; version?: string }[]>> {
    const res = await fetch(`${this.baseUrl}/api/cli-agents`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- Design Systems ---

  async listDesignSystems(): Promise<ApiResponse<DesignSystem[]>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems`, { headers: this.getHeaders() });
    return res.json();
  }

  async createDesignSystem(name: string, description?: string): Promise<ApiResponse<DesignSystem>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    return res.json();
  }

  async deleteDesignSystem(id: string): Promise<ApiResponse<null>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async getDesignSystemContent(id: string): Promise<ApiResponse<{ content: string }>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems/${id}/content`, { headers: this.getHeaders() });
    return res.json();
  }

  async saveDesignSystemContent(id: string, content: string): Promise<ApiResponse<null>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems/${id}/content`, {
      method: 'PUT',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return res.json();
  }

  // --- Artifacts ---

  async listArtifacts(params: { workflowId?: string; runId?: string }): Promise<ApiResponse<Artifact[]>> {
    const q = params.runId ? `runId=${params.runId}` : `workflowId=${params.workflowId}`;
    const res = await fetch(`${this.baseUrl}/api/artifacts?${q}`, { headers: this.getHeaders() });
    return res.json();
  }

  async getArtifact(id: string): Promise<ApiResponse<Artifact>> {
    const res = await fetch(`${this.baseUrl}/api/artifacts/${id}`, { headers: this.getHeaders() });
    return res.json();
  }

  // --- Routines ---

  async listRoutines(): Promise<ApiResponse<Routine[]>> {
    const res = await fetch(`${this.baseUrl}/api/routines`, { headers: this.getHeaders() });
    return res.json();
  }

  async getRoutine(id: string): Promise<ApiResponse<Routine>> {
    const res = await fetch(`${this.baseUrl}/api/routines/${id}`, { headers: this.getHeaders() });
    return res.json();
  }

  async createRoutine(input: {
    name: string;
    workflowId: string;
    schedule: string;
    enabled?: boolean;
    inputs?: Record<string, unknown>;
  }): Promise<ApiResponse<Routine>> {
    const res = await fetch(`${this.baseUrl}/api/routines`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.json();
  }

  async updateRoutine(id: string, input: Partial<{ name: string; schedule: string; enabled: boolean; inputs: Record<string, unknown> }>): Promise<ApiResponse<Routine>> {
    const res = await fetch(`${this.baseUrl}/api/routines/${id}`, {
      method: 'PUT',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.json();
  }

  async deleteRoutine(id: string): Promise<ApiResponse<null>> {
    const res = await fetch(`${this.baseUrl}/api/routines/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async runRoutineNow(id: string): Promise<ApiResponse<{ runId: string }>> {
    const res = await fetch(`${this.baseUrl}/api/routines/${id}/run`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async listRoutineRuns(id: string): Promise<ApiResponse<RoutineRun[]>> {
    const res = await fetch(`${this.baseUrl}/api/routines/${id}/runs`, { headers: this.getHeaders() });
    return res.json();
  }

  // --- Plugins ---

  async listPlugins(): Promise<ApiResponse<unknown[]>> {
    const res = await fetch(`${this.baseUrl}/api/plugins`, { headers: this.getHeaders() });
    return res.json();
  }

  async getPlugin(id: string): Promise<ApiResponse<unknown>> {
    const res = await fetch(`${this.baseUrl}/api/plugins/${id}`, { headers: this.getHeaders() });
    return res.json();
  }

  runPlugin(
    id: string,
    inputs: Record<string, unknown>,
    onEvent: (event: unknown) => void,
  ): { stop: () => void; runIdPromise: Promise<string | null> } {
    const controller = new AbortController();
    const runIdPromise = (async () => {
      try {
        const res = await fetch(`${this.baseUrl}/api/plugins/${id}/run`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({ inputs }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) return null;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let runId: string | null = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.startsWith('data: ') ? part.slice(6) : part;
            try {
              const event = JSON.parse(line);
              if (event.type === 'pipeline.started') runId = event.runId;
              onEvent(event);
            } catch { /* ignore */ }
          }
        }
        return runId;
      } catch { return null; }
    })();
    return { stop: () => controller.abort(), runIdPromise };
  }

  async resumePlugin(
    id: string,
    runId: string,
    stageId: string,
    response: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const res = await fetch(`${this.baseUrl}/api/plugins/${id}/run/${runId}/resume`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ stageId, response }),
    });
    return res.json();
  }

  // --- Workflows ---

  async listWorkflows(): Promise<ApiResponse<Workflow[]>> {
    const res = await fetch(`${this.baseUrl}/api/workflow`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async getWorkflow(id: string): Promise<ApiResponse<Workflow>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async createWorkflow(input: {
    name: string;
    description?: string;
    domain?: string;
    nodes?: unknown[];
    edges?: unknown[];
  }): Promise<ApiResponse<Workflow>> {
    const res = await fetch(`${this.baseUrl}/api/workflow`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return res.json();
  }

  async updateWorkflow(
    id: string,
    input: { name?: string; description?: string; designSystemId?: string; nodes?: unknown[]; edges?: unknown[] },
  ): Promise<ApiResponse<Workflow>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return res.json();
  }

  async deleteWorkflow(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async duplicateWorkflow(id: string): Promise<ApiResponse<Workflow>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}/duplicate`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async exportWorkflow(id: string, workflowName: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}/export`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const safeName = workflowName.replace(/[^a-z0-9_-]/gi, '_');
    const filename = `${safeName}.neos.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async importWorkflow(data: {
    version: string;
    workflow: {
      name: string;
      description?: string;
      domain: string;
      nodes: unknown[];
      edges: unknown[];
    };
  }): Promise<ApiResponse<Workflow>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/import`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async importWorkflowZip(file: File): Promise<ApiResponse<Workflow>> {
    const form = new FormData();
    form.append('file', file);
    const headers = this.getHeaders();
    // FormData sets its own Content-Type boundary — remove it
    delete (headers as Record<string, string>)['Content-Type'];
    const res = await fetch(`${this.baseUrl}/api/workflow/import.zip`, {
      method: 'POST',
      headers,
      body: form,
    });
    return res.json();
  }

  async exportWorkflowZip(id: string, filename: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}/export.zip`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.zip') ? filename : `${filename}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  runWorkflow(id: string, onEvent: (event: WorkflowSSEEvent) => void, inputs?: Record<string, unknown>): () => void {
    const controller = new AbortController();
    (async () => {
      const body = inputs ? JSON.stringify({ inputs }) : undefined;
      const res = await fetch(`${this.baseUrl}/api/workflow/${id}/run`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
        signal: controller.signal,
      });
      if (!res.body) return;
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
          if (line.startsWith('data: ')) {
            try {
              onEvent(JSON.parse(line.slice(6)) as WorkflowSSEEvent);
            } catch {
              // skip malformed
            }
          }
        }
      }
    })().catch(() => {});
    return () => controller.abort();
  }

  async listWorkflowRuns(workflowId: string, limit = 20, offset = 0): Promise<ApiResponse<WorkflowRun[]>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${workflowId}/runs?limit=${limit}&offset=${offset}`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async getWorkflowRun(workflowId: string, runId: string): Promise<ApiResponse<WorkflowRun>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${workflowId}/runs/${runId}`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async deleteWorkflowRun(workflowId: string, runId: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${workflowId}/runs/${runId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- Webhook ---

  async getWebhookSecret(workflowId: string): Promise<ApiResponse<{ secret: string }>> {
    const res = await fetch(`${this.baseUrl}/api/webhook/${workflowId}/secret`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async regenerateWebhookSecret(workflowId: string): Promise<ApiResponse<{ secret: string }>> {
    const res = await fetch(`${this.baseUrl}/api/webhook/${workflowId}/regenerate`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- Workflow Revisions ---

  async listRevisions(workflowId: string): Promise<ApiResponse<WorkflowRevision[]>> {
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${workflowId}`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async getRevision(workflowId: string, revisionId: string): Promise<ApiResponse<WorkflowRevision>> {
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${workflowId}/${revisionId}`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async updateRevisionLabel(workflowId: string, revisionId: string, label: string): Promise<ApiResponse<WorkflowRevision>> {
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${workflowId}/${revisionId}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ label }),
    });
    return res.json();
  }

  async deleteRevision(workflowId: string, revisionId: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${workflowId}/${revisionId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- Harnesses ---

  async listHarnesses(): Promise<ApiResponse<AgentHarness[]>> {
    const res = await fetch(`${this.baseUrl}/api/harness`, {
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async createHarness(input: Omit<AgentHarness, 'isBuiltIn'>): Promise<ApiResponse<AgentHarness>> {
    const res = await fetch(`${this.baseUrl}/api/harness`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return res.json();
  }

  async updateHarness(id: string, input: Partial<AgentHarness>): Promise<ApiResponse<AgentHarness>> {
    const res = await fetch(`${this.baseUrl}/api/harness/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return res.json();
  }

  async deleteHarness(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/harness/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- Blocks ---

  async listBlocks(domain?: string): Promise<ApiResponse<WorkflowBlock[]>> {
    const url = domain
      ? `${this.baseUrl}/api/blocks?domain=${encodeURIComponent(domain)}`
      : `${this.baseUrl}/api/blocks`;
    const res = await fetch(url, { headers: this.getHeaders() });
    return res.json();
  }

  async createBlock(input: Omit<WorkflowBlock, 'isBuiltIn'>): Promise<ApiResponse<WorkflowBlock>> {
    const res = await fetch(`${this.baseUrl}/api/blocks`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return res.json();
  }

  async updateBlock(id: string, input: Partial<WorkflowBlock>): Promise<ApiResponse<WorkflowBlock>> {
    const res = await fetch(`${this.baseUrl}/api/blocks/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return res.json();
  }

  async deleteBlock(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/blocks/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  // --- Templates ---

  async getTemplates(domain?: string): Promise<ApiResponse<unknown[]>> {
    const url = domain
      ? `${this.baseUrl}/api/templates?domain=${encodeURIComponent(domain)}`
      : `${this.baseUrl}/api/templates`;
    const res = await fetch(url, { headers: this.getHeaders() });
    return res.json();
  }

  // --- Memory ---

  async listMemories(): Promise<ApiResponse<MemoryItem[]>> {
    const res = await fetch(`${this.baseUrl}/api/memory`, { headers: this.getHeaders() });
    return res.json();
  }

  async createMemory(input: CreateMemoryInput): Promise<ApiResponse<MemoryItem>> {
    const res = await fetch(`${this.baseUrl}/api/memory`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return res.json();
  }

  async updateMemory(id: string, input: UpdateMemoryInput): Promise<ApiResponse<MemoryItem>> {
    const res = await fetch(`${this.baseUrl}/api/memory/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return res.json();
  }

  async deleteMemory(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/memory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return res.json();
  }

  async toggleMemory(id: string): Promise<ApiResponse<MemoryItem>> {
    const res = await fetch(`${this.baseUrl}/api/memory/${encodeURIComponent(id)}/toggle`, {
      method: 'PUT',
      headers: this.getHeaders(),
    });
    return res.json();
  }
}

// Local type mirrors to avoid adding @neos-work/shared to desktop package
export type WorkflowNodeType =
  | 'trigger'
  | 'agent_finance'
  | 'agent_coding'
  | 'block'
  | 'gate_and'
  | 'gate_or'
  | 'web_search'
  | 'slack_message'
  | 'discord_message'
  | 'output';

interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  domain: 'finance' | 'coding' | 'general';
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  webhookSecret?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRevision {
  id: string;
  workflowId: string;
  snapshot?: string;
  label?: string;
  createdAt: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  nodeResults: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface AgentHarness {
  id: string;
  name: string;
  domain: 'finance' | 'coding' | 'general';
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  isBuiltIn?: boolean;
  constraints?: { maxSteps?: number; maxTokens?: number; timeoutMs?: number };
}

export type WorkflowSSEEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'node.started'; nodeId: string; nodeType: string }
  | { type: 'node.progress'; nodeId: string; chunk: string; accumulated: string }
  | { type: 'node.completed'; nodeId: string; output: unknown; durationMs?: number }
  | { type: 'node.failed'; nodeId: string; error: string }
  | { type: 'run.completed'; runId: string; duration: number; artifactId?: string }
  | { type: 'run.failed'; runId: string; error: string };

export interface WorkflowBlock {
  id: string;
  name: string;
  domain: 'finance' | 'coding' | 'general';
  category: string;
  description: string;
  isBuiltIn: boolean;
  implementationType: 'native' | 'prompt' | 'skill';
  paramDefs: Array<{ key: string; label: string; type: string; description?: string; default?: unknown; options?: string[]; min?: number; max?: number }>;
  inputDescription: string;
  outputDescription: string;
  requiredSettings?: string[];
  promptTemplate?: string;
  skillId?: string;
}

export type MemoryType = 'user' | 'session' | 'skill' | 'reference';

export interface MemoryItem {
  id: string;
  name: string;
  type: MemoryType;
  enabled: boolean;
  content: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryInput {
  name: string;
  type: MemoryType;
  content: string;
  enabled?: boolean;
}

export interface UpdateMemoryInput {
  name?: string;
  type?: MemoryType;
  content?: string;
  enabled?: boolean;
}
