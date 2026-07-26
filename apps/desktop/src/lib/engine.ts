/**
 * Engine client — communicates with the NEOS Work engine server.
 */

import type { ApiResponse, ChatChunk, HealthResponse } from '@neos-work/shared';

/**
 * Extract SSE `data:` payload. Rejects null-byte lines (control injection);
 * trims trailing CR from CRLF streams.
 * Exported for unit tests.
 */
export function parseSseDataPayload(line: string): string | null {
  if (typeof line !== 'string' || !line.startsWith('data:')) return null;
  // Allow "data:" or "data: " prefix
  let payload = line.slice(5);
  if (payload.startsWith(' ')) payload = payload.slice(1);
  // Null-byte SSE payloads never parsed (JSON injection / log hygiene)
  if (/\0/.test(payload)) return null;
  // Strip trailing CR from CRLF framing; keep JSON body intact
  if (payload.endsWith('\r')) payload = payload.slice(0, -1);
  payload = payload.trim();
  return payload.length > 0 ? payload : null;
}

/**
 * Extract SSE `event:` name. Control-char / blank → empty (caller skips).
 * Exported for unit tests.
 */
export function parseSseEventName(line: string): string {
  if (typeof line !== 'string' || !line.startsWith('event:')) return '';
  let name = line.slice(6);
  if (name.startsWith(' ')) name = name.slice(1);
  // Control-char event names rejected before trim
  if (/[\0\r\n]/.test(name)) return '';
  return name.trim();
}

/**
 * Format an HTTP error for SSE/UI surfaces. Scrubs control chars from statusText
 * so hostile proxies cannot inject multi-line / null-byte error chrome.
 * Exported for unit tests.
 */
export function formatHttpErrorMessage(status: number, statusText: unknown): string {
  const code = Number.isFinite(status) ? Math.trunc(status) : 0;
  let st = typeof statusText === 'string' ? statusText : '';
  if (/\0/.test(st)) st = st.replace(/\0/g, '');
  st = st.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  return st ? `HTTP ${code}: ${st}` : `HTTP ${code}`;
}

/**
 * Scrub API error strings (webhook fire, etc.) before surfacing to UI.
 * Exported for unit tests.
 */
export function scrubApiErrorMessage(raw: unknown, fallback = 'Request failed'): string {
  let s = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
  if (/\0/.test(s)) s = s.replace(/\0/g, '');
  s = s.replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  return s || fallback;
}

/**
 * Parse an ApiResponse JSON body. Invalid JSON / non-object bodies never throw
 * SyntaxError into UI handlers — returns a scrubbed `{ ok: false, error }`.
 * Exported for unit tests.
 */
export async function readApiResponse<T = unknown>(res: Response): Promise<ApiResponse<T>> {
  try {
    const body: unknown = await res.json();
    // Arrays / null are typeof object — only plain objects are ApiResponse envelopes
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const envelope = body as ApiResponse<T>;
      // Defense-in-depth: scrub control-char error strings from any envelope
      if (envelope.error != null) {
        return {
          ...envelope,
          error: scrubApiErrorMessage(envelope.error, 'Request failed'),
        };
      }
      return envelope;
    }
  } catch {
    /* invalid JSON */
  }
  return {
    ok: false,
    error: scrubApiErrorMessage(
      res.statusText,
      formatHttpErrorMessage(res.status, res.statusText),
    ),
  };
}

/**
 * Parse health JSON. Invalid body throws a clean Error (checkConnection catches).
 * Exported for unit tests.
 */
export async function readHealthResponse(res: Response): Promise<HealthResponse> {
  try {
    const body: unknown = await res.json();
    if (
      body
      && typeof body === 'object'
      && !Array.isArray(body)
      && body !== null
      && 'status' in body
    ) {
      return body as HealthResponse;
    }
  } catch {
    /* invalid JSON */
  }
  throw new Error(formatHttpErrorMessage(res.status, res.statusText));
}

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

/** Built-in MCP server preset (e.g. TradingView). */
export interface McpPresetData {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  transport: 'stdio' | 'http';
  command?: string;
  argsTemplate?: string[];
  entryRelativePath?: string;
  requirements: string[];
  toolHints: string[];
  domain?: 'finance' | 'coding' | 'general';
}

export interface TradingViewCdpHealthData {
  ok: boolean;
  cdpConnected: boolean;
  port: number;
  browser?: string;
  protocolVersion?: string;
  webSocketDebuggerUrl?: string;
  targetCount?: number;
  error?: string;
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

export interface Plugin {
  id: string;
  name: string;
  description?: string;
  version: string;
  pipeline?: Array<{
    id: string;
    name: string;
    kind: string;
    humanInLoop?: boolean;
    schema?: unknown;
  }>;
  inputFields?: Array<{ key: string; label: string; type: string; placeholder?: string }>;
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
  kind: 'image' | 'audio' | 'other';
  mimeType: string;
  createdAt: string;
  urlPath: string;
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

  /**
   * Set Bearer token for API calls.
   * Control-char / blank tokens are rejected (header injection defense) — clears auth.
   */
  setAuthToken(token: string | null | undefined): void {
    if (token == null || typeof token !== 'string') {
      this.authToken = null;
      return;
    }
    // Reject control chars before trim (trim would strip CR/LF)
    if (/[\0\r\n]/.test(token)) {
      this.authToken = null;
      return;
    }
    const next = token.trim();
    this.authToken = next || null;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Defense-in-depth: never emit control-char Bearer tokens
    if (
      this.authToken
      && typeof this.authToken === 'string'
      && !/[\0\r\n]/.test(this.authToken)
      && this.authToken.trim()
    ) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

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
    const qs = workspaceId ? `?workspaceId=${workspaceId}` : '';
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
    const res = await fetch(`${this.baseUrl}/api/session`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    return readApiResponse(res);
  }

  async deleteSession(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/session/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Messages ---

  async listMessages(sessionId: string): Promise<ApiResponse<MessageData[]>> {
    const res = await fetch(`${this.baseUrl}/api/session/${sessionId}/messages`, {
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
    const res = await fetch(`${this.baseUrl}/api/session/${sessionId}/chat`, {
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
    const res = await fetch(`${this.baseUrl}/api/session/${sessionId}/agent`, {
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
    const res = await fetch(`${this.baseUrl}/api/session/${sessionId}/cancel`, {
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
    const res = await fetch(
      `${this.baseUrl}/api/session/${sessionId}/tool-confirm/${toolUseId}`,
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
  }): Promise<ApiResponse<{ id: string; name: string; type: string }>> {
    const res = await fetch(`${this.baseUrl}/api/workspace`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    return readApiResponse(res);
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
    return readApiResponse(res);
  }

  async deleteWorkspace(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/workspace/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Settings ---

  async getSettings(): Promise<ApiResponse<Record<string, string>>> {
    const res = await fetch(`${this.baseUrl}/api/settings`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getSetting(key: string): Promise<ApiResponse<{ key: string; value: string }>> {
    const res = await fetch(`${this.baseUrl}/api/settings/${encodeURIComponent(key)}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async saveSetting(key: string, value: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ value }),
    });
    return readApiResponse(res);
  }

  async verifyApiKey(provider: string, key: string): Promise<ApiResponse<{ valid: boolean }>> {
    const res = await fetch(`${this.baseUrl}/api/settings/verify-key`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ provider, key }),
    });
    return readApiResponse(res);
  }

  // --- Models ---

  async listModels(): Promise<ApiResponse<{ id: string; name: string; providerId: string }[]>> {
    const res = await fetch(`${this.baseUrl}/api/models`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Skills ---

  async listSkills(): Promise<ApiResponse<SkillData[]>> {
    const res = await fetch(`${this.baseUrl}/api/skills`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async scanSkills(): Promise<ApiResponse<{ scanned: number; total: number }>> {
    const res = await fetch(`${this.baseUrl}/api/skills/scan`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async toggleSkill(id: string, enabled: boolean): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/skills/${id}/toggle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ enabled }),
    });
    return readApiResponse(res);
  }

  async deleteSkill(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/skills/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async upgradeSkillToPlugin(skillId: string): Promise<ApiResponse<Plugin>> {
    const res = await fetch(`${this.baseUrl}/api/plugins/upgrade-from-skill`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId }),
    });
    return readApiResponse(res);
  }

  // --- MCP Servers ---

  async listMcpServers(): Promise<ApiResponse<McpServerData[]>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
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
    return readApiResponse(res);
  }

  async listMcpPresets(): Promise<ApiResponse<McpPresetData[]>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/presets`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async createMcpServerFromPreset(params: {
    presetId: string;
    installPath?: string;
    name?: string;
  }): Promise<ApiResponse<McpServerData>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/from-preset`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    return readApiResponse(res);
  }

  async checkTradingViewCdp(port?: number): Promise<ApiResponse<TradingViewCdpHealthData>> {
    const q =
      typeof port === 'number' && Number.isFinite(port)
        ? `?port=${encodeURIComponent(String(Math.floor(port)))}`
        : '';
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/tradingview/cdp-health${q}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async toggleMcpServer(id: string, enabled: boolean): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/${id}/toggle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ enabled }),
    });
    return readApiResponse(res);
  }

  async deleteMcpServer(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
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
    return readApiResponse(res);
  }

  async getMcpOAuthStatus(serverId: string): Promise<ApiResponse<{ connected: boolean; expiresAt?: string; scope?: string }>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/oauth/${serverId}/status`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async revokeMcpOAuth(serverId: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/oauth/${serverId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async refreshMcpOAuth(serverId: string, params: { tokenEndpoint: string; clientId: string }): Promise<ApiResponse<{ connected: boolean; expiresAt?: string }>> {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/oauth/${serverId}/refresh`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
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

  // --- Design Systems ---

  async listDesignSystems(): Promise<ApiResponse<DesignSystem[]>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async createDesignSystem(name: string, description?: string): Promise<ApiResponse<DesignSystem>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    return readApiResponse(res);
  }

  async deleteDesignSystem(id: string): Promise<ApiResponse<null>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getDesignSystemContent(id: string): Promise<ApiResponse<{ content: string }>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems/${id}/content`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async saveDesignSystemContent(id: string, content: string): Promise<ApiResponse<null>> {
    const res = await fetch(`${this.baseUrl}/api/design-systems/${id}/content`, {
      method: 'PUT',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return readApiResponse(res);
  }

  // --- Artifacts ---

  async listArtifacts(params: { workflowId?: string; runId?: string }): Promise<ApiResponse<Artifact[]>> {
    const q = params.runId ? `runId=${params.runId}` : `workflowId=${params.workflowId}`;
    const res = await fetch(`${this.baseUrl}/api/artifacts?${q}`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async getArtifact(id: string): Promise<ApiResponse<Artifact>> {
    const res = await fetch(`${this.baseUrl}/api/artifacts/${id}`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async refreshArtifact(
    id: string,
    mode: 'reload' | 'rerun' = 'reload',
  ): Promise<ApiResponse<Artifact> & { meta?: { mode?: string; workflowId?: string; nodeId?: string; message?: string } }> {
    const res = await fetch(`${this.baseUrl}/api/artifacts/${id}/refresh`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    return readApiResponse(res);
  }

  async deleteArtifact(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/artifacts/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async updateArtifact(
    id: string,
    input: { name?: string; content?: string },
  ): Promise<ApiResponse<Artifact>> {
    const res = await fetch(`${this.baseUrl}/api/artifacts/${id}`, {
      method: 'PATCH',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteMediaFile(filename: string): Promise<ApiResponse<void>> {
    const res = await fetch(this.mediaFileUrl(filename), {
      method: 'DELETE',
      headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
    });
    return readApiResponse(res);
  }

  // --- Routines ---

  async listRoutines(): Promise<ApiResponse<Routine[]>> {
    const res = await fetch(`${this.baseUrl}/api/routines`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async getRoutine(id: string): Promise<ApiResponse<Routine>> {
    const res = await fetch(`${this.baseUrl}/api/routines/${id}`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async createRoutine(input: {
    name: string;
    workflowId: string;
    schedule: string;
    timezone?: string;
    enabled?: boolean;
    inputs?: Record<string, unknown>;
  }): Promise<ApiResponse<Routine>> {
    const res = await fetch(`${this.baseUrl}/api/routines`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async updateRoutine(id: string, input: Partial<{ name: string; schedule: string; timezone: string; enabled: boolean; inputs: Record<string, unknown> }>): Promise<ApiResponse<Routine>> {
    const res = await fetch(`${this.baseUrl}/api/routines/${id}`, {
      method: 'PUT',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async listMediaFiles(limit = 100): Promise<ApiResponse<MediaFileInfo[]>> {
    const res = await fetch(`${this.baseUrl}/api/media/files?limit=${limit}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Media generation readiness (no secrets returned). */
  async getMediaConfig(): Promise<
    ApiResponse<{
      openaiConfigured: boolean;
      openaiBaseUrl: string | null;
      surfaces: string[];
      imageModels: string[];
      audioModels: string[];
    }>
  > {
    const res = await fetch(`${this.baseUrl}/api/media/config`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  mediaFileUrl(filename: string): string {
    return `${this.baseUrl}/api/media/file/${encodeURIComponent(filename)}`;
  }

  /** Authenticated fetch of a media file as Blob (for FileViewer). */
  async fetchMediaBlob(filename: string): Promise<Blob> {
    const res = await fetch(this.mediaFileUrl(filename), {
      headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
    });
    if (!res.ok) throw new Error(`Failed to load media (${res.status})`);
    return res.blob();
  }

  async refreshDeployment(id: string): Promise<ApiResponse<Deployment>> {
    const res = await fetch(`${this.baseUrl}/api/deploy/${id}/refresh`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async deleteRoutine(id: string): Promise<ApiResponse<null>> {
    const res = await fetch(`${this.baseUrl}/api/routines/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async runRoutineNow(id: string): Promise<ApiResponse<{ runId: string }>> {
    const res = await fetch(`${this.baseUrl}/api/routines/${id}/run`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async listRoutineRuns(id: string): Promise<ApiResponse<RoutineRun[]>> {
    const res = await fetch(`${this.baseUrl}/api/routines/${id}/runs`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async crystallizeRoutineRun(
    routineId: string,
    runId: string,
    input?: { name?: string; description?: string },
  ): Promise<ApiResponse<{ skillId: string; name: string; path: string }>> {
    const res = await fetch(`${this.baseUrl}/api/routines/${routineId}/runs/${runId}/crystallize`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input ?? {}),
    });
    return readApiResponse(res);
  }

  async deployPreflight(provider: 'vercel' | 'cloudflare', projectName?: string): Promise<
    ApiResponse<{ provider: string; ready: boolean; checks: Array<{ key: string; ok: boolean; message: string }> }>
  > {
    const res = await fetch(`${this.baseUrl}/api/deploy/preflight`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, projectName }),
    });
    return readApiResponse(res);
  }

  // --- Plugins ---

  async listPlugins(): Promise<ApiResponse<Plugin[]>> {
    const res = await fetch(`${this.baseUrl}/api/plugins`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async getPlugin(id: string): Promise<ApiResponse<Plugin>> {
    const res = await fetch(`${this.baseUrl}/api/plugins/${id}`, { headers: this.getHeaders() });
    return readApiResponse(res);
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
            // Part may be multi-line; take first data: line
            const dataLine = part
              .split('\n')
              .find((l) => l.startsWith('data:'));
            const payload = dataLine ? parseSseDataPayload(dataLine) : null;
            // Fallback: bare JSON without data: prefix (tests / legacy)
            let jsonText = payload;
            if (!jsonText && part && !/\0/.test(part)) {
              const bare = part.trim();
              if (bare.startsWith('{')) jsonText = bare;
            }
            if (!jsonText) continue;
            try {
              const event = JSON.parse(jsonText) as { type?: string; runId?: string };
              if (event.type === 'pipeline.started' && typeof event.runId === 'string') {
                // Control-char runId ignored
                if (!/[\0\r\n]/.test(event.runId)) {
                  const idTrim = event.runId.trim();
                  if (idTrim) runId = idTrim;
                }
              }
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
    return readApiResponse(res);
  }

  // --- Workflows ---

  async listWorkflows(): Promise<ApiResponse<Workflow[]>> {
    const res = await fetch(`${this.baseUrl}/api/workflow`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getWorkflow(id: string): Promise<ApiResponse<Workflow>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
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
    return readApiResponse(res);
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
    return readApiResponse(res);
  }

  async deleteWorkflow(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async duplicateWorkflow(id: string): Promise<ApiResponse<Workflow>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}/duplicate`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /**
   * Download workflow JSON export.
   * @returns true when a download was triggered; false on HTTP failure.
   */
  async exportWorkflow(id: string, workflowName: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}/export`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    // Drop control chars then collapse non-filename alphabet; never empty download base
    let raw = typeof workflowName === 'string' ? workflowName : '';
    if (/\0/.test(raw)) raw = raw.replace(/\0/g, '');
    raw = raw.replace(/[\r\n]+/g, ' ').trim();
    const safeName = raw.replace(/[^a-z0-9_-]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'workflow';
    const filename = `${safeName.slice(0, 120)}.neos.json`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
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
    return readApiResponse(res);
  }

  async importWorkflowZip(file: File): Promise<ApiResponse<Workflow> & { meta?: { importKind?: string; artifactId?: string } }> {
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
    return readApiResponse(res);
  }

  /** Import Claude Design / HTML-only ZIP as a workflow + artifact */
  async importClaudeDesignZip(file: File): Promise<ApiResponse<Workflow> & { meta?: { importKind?: string; artifactId?: string } }> {
    const form = new FormData();
    form.append('file', file);
    const headers = this.getHeaders();
    delete (headers as Record<string, string>)['Content-Type'];
    const res = await fetch(`${this.baseUrl}/api/workflow/import/claude-design`, {
      method: 'POST',
      headers,
      body: form,
    });
    return readApiResponse(res);
  }

  /**
   * Download workflow ZIP export.
   * @returns true when a download was triggered; false on HTTP failure.
   */
  async exportWorkflowZip(id: string, filename: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${id}/export.zip`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Align with exportWorkflow: scrub control chars then filename-safe alphabet
    let raw = typeof filename === 'string' ? filename : '';
    if (/\0/.test(raw)) raw = raw.replace(/\0/g, '');
    raw = raw.replace(/[\r\n]+/g, ' ').trim().replace(/\.zip$/i, '');
    const base =
      raw.replace(/[^a-z0-9_-]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 120)
      || 'workflow';
    a.download = `${base}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    return true;
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
          if (line.startsWith('data:')) {
            const data = parseSseDataPayload(line);
            if (!data) continue;
            try {
              onEvent(JSON.parse(data) as WorkflowSSEEvent);
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
    return readApiResponse(res);
  }

  async getWorkflowRun(workflowId: string, runId: string): Promise<ApiResponse<WorkflowRun>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${workflowId}/runs/${runId}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async deleteWorkflowRun(workflowId: string, runId: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${workflowId}/runs/${runId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Clear runs for a workflow. Optional status filter. */
  async clearWorkflowRuns(
    workflowId: string,
    status?: 'completed' | 'failed' | 'cancelled' | 'running',
  ): Promise<ApiResponse<{ deleted: number }>> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await fetch(`${this.baseUrl}/api/workflow/${workflowId}/runs${qs}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async preflightWorkflow(workflowId: string): Promise<ApiResponse<{
    ok: boolean;
    issues: Array<{ code: string; severity: 'error' | 'warning'; message: string; nodeId?: string }>;
  }>> {
    const res = await fetch(`${this.baseUrl}/api/workflow/${workflowId}/preflight`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Webhook ---

  async getWebhookSecret(workflowId: string): Promise<ApiResponse<{
    secret: string;
    rateLimit?: { limit: number; remaining: number; resetAt: number; windowMs: number };
  }>> {
    const res = await fetch(`${this.baseUrl}/api/webhook/${workflowId}/secret`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getWebhookRateLimit(workflowId: string): Promise<ApiResponse<{
    limit: number;
    remaining: number;
    resetAt: number;
    windowMs: number;
  }>> {
    const res = await fetch(`${this.baseUrl}/api/webhook/${workflowId}/rate-limit`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async regenerateWebhookSecret(workflowId: string): Promise<ApiResponse<{ secret: string }>> {
    const res = await fetch(`${this.baseUrl}/api/webhook/${workflowId}/regenerate`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /**
   * Fire the public webhook endpoint with a valid HMAC (plan Task 13).
   * Uses the stored secret from getWebhookSecret; does not send Bearer auth.
   */
  async testWebhookFire(
    workflowId: string,
    body: Record<string, unknown> = {},
  ): Promise<{ ok: boolean; status: number; error?: string }> {
    const secretRes = await this.getWebhookSecret(workflowId);
    if (!secretRes.ok || !secretRes.data?.secret) {
      return { ok: false, status: 0, error: 'Failed to load webhook secret' };
    }
    const { hmacSha256Hex } = await import('./hmac.js');
    const raw = JSON.stringify(body);
    const sig = await hmacSha256Hex(secretRes.data.secret, raw);
    const res = await fetch(`${this.baseUrl}/api/webhook/${workflowId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Neos-Signature': `sha256=${sig}`,
      },
      body: raw,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as { error?: string };
      const raw = errBody.error ?? res.statusText;
      return {
        ok: false,
        status: res.status,
        error: scrubApiErrorMessage(raw, formatHttpErrorMessage(res.status, res.statusText)),
      };
    }
    // SSE stream — we only need to confirm acceptance; cancel read
    try { res.body?.cancel(); } catch { /* ignore */ }
    return { ok: true, status: res.status };
  }

  // --- Workflow Revisions ---

  async listRevisions(workflowId: string): Promise<ApiResponse<WorkflowRevision[]>> {
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${workflowId}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getRevision(workflowId: string, revisionId: string): Promise<ApiResponse<WorkflowRevision>> {
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${workflowId}/${revisionId}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Persist a revision snapshot onto the workflow record (plan Task 16). */
  async restoreRevision(
    workflowId: string,
    revisionId: string,
  ): Promise<ApiResponse<Workflow> & { meta?: { restoredFrom?: string; label?: string } }> {
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${workflowId}/${revisionId}/restore`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async updateRevisionLabel(workflowId: string, revisionId: string, label: string): Promise<ApiResponse<WorkflowRevision>> {
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${workflowId}/${revisionId}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ label }),
    });
    return readApiResponse(res);
  }

  async deleteRevision(workflowId: string, revisionId: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${workflowId}/${revisionId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Deployments ---

  async listDeployments(workflowId?: string, limit = 100): Promise<ApiResponse<Deployment[]>> {
    const params = new URLSearchParams();
    if (workflowId) params.set('workflowId', workflowId);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    const res = await fetch(`${this.baseUrl}/api/deploy${qs ? `?${qs}` : ''}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getDeployment(id: string): Promise<ApiResponse<Deployment>> {
    const res = await fetch(`${this.baseUrl}/api/deploy/${id}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async deleteDeployment(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/deploy/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Harnesses ---

  async listHarnesses(): Promise<ApiResponse<AgentHarness[]>> {
    const res = await fetch(`${this.baseUrl}/api/harness`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async createHarness(input: Omit<AgentHarness, 'isBuiltIn'>): Promise<ApiResponse<AgentHarness>> {
    const res = await fetch(`${this.baseUrl}/api/harness`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async updateHarness(id: string, input: Partial<AgentHarness>): Promise<ApiResponse<AgentHarness>> {
    const res = await fetch(`${this.baseUrl}/api/harness/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteHarness(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/harness/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Blocks ---

  async listBlocks(domain?: string): Promise<ApiResponse<WorkflowBlock[]>> {
    const url = domain
      ? `${this.baseUrl}/api/blocks?domain=${encodeURIComponent(domain)}`
      : `${this.baseUrl}/api/blocks`;
    const res = await fetch(url, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async createBlock(input: Omit<WorkflowBlock, 'isBuiltIn'>): Promise<ApiResponse<WorkflowBlock>> {
    const res = await fetch(`${this.baseUrl}/api/blocks`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async updateBlock(id: string, input: Partial<WorkflowBlock>): Promise<ApiResponse<WorkflowBlock>> {
    const res = await fetch(`${this.baseUrl}/api/blocks/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteBlock(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/blocks/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Templates ---

  async getTemplates(domain?: string): Promise<ApiResponse<unknown[]>> {
    const url = domain
      ? `${this.baseUrl}/api/templates?domain=${encodeURIComponent(domain)}`
      : `${this.baseUrl}/api/templates`;
    const res = await fetch(url, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  // --- Memory ---

  async listMemories(): Promise<ApiResponse<MemoryItem[]>> {
    const res = await fetch(`${this.baseUrl}/api/memory`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async createMemory(input: CreateMemoryInput): Promise<ApiResponse<MemoryItem>> {
    const res = await fetch(`${this.baseUrl}/api/memory`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async updateMemory(id: string, input: UpdateMemoryInput): Promise<ApiResponse<MemoryItem>> {
    const res = await fetch(`${this.baseUrl}/api/memory/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteMemory(id: string): Promise<ApiResponse<void>> {
    const res = await fetch(`${this.baseUrl}/api/memory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async toggleMemory(id: string): Promise<ApiResponse<MemoryItem>> {
    const res = await fetch(`${this.baseUrl}/api/memory/${encodeURIComponent(id)}/toggle`, {
      method: 'PUT',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
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
  designSystemId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRevision {
  id: string;
  workflowId: string;
  snapshot?: string;
  label?: string;
  createdAt: string;
  nodeCount?: number;
  edgeCount?: number;
}

export interface Deployment {
  id: string;
  workflowId?: string;
  runId?: string;
  provider: string;
  projectName?: string;
  url?: string;
  deploymentId?: string;
  status: 'pending' | 'deploying' | 'success' | 'failed';
  statusMessage?: string;
  createdAt: string;
  updatedAt: string;
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
