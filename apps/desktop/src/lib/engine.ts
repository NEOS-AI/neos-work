/**
 * Engine client — communicates with the NEOS Work engine server.
 * v0.12: Design Project API on EngineProjectClient; Workflows on EngineWorkflowClient.
 */

import {
  type ApiResponse,
  type ChatChunk,
  type HealthResponse,
} from '@neos-work/shared';

export {
  EngineTransport,
  formatHttpErrorMessage,
  parseSseDataPayload,
  parseSseEventName,
  readApiResponse,
  readHealthResponse,
  scrubApiErrorMessage,
  isActiveRunStatus,
  isTerminalRunStatus,
  normalizeProjectRelPath,
  normalizeRunStatus,
} from './engine-transport.js';
export type { ProjectRunEvent, ProjectRunStatus, ProjectRunSummary } from './engine-transport.js';

export {
  EngineProjectClient,
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
} from './engine-project.js';

export {
  EngineWorkflowClient,
  type WorkflowNodeType,
  type Workflow,
  type WorkflowRevision,
  type Deployment,
  type WorkflowRun,
  type AgentHarness,
  type DomainWorker,
  type WorkflowSSEEvent,
  type WorkflowBlock,
} from './engine-workflow.js';

import {
  EngineProjectClient,
  type Artifact,
  type LiveArtifact,
  type LiveArtifactRefresh,
  type MediaFileInfo,
  type Plugin,
  type PluginListMeta,
  type Routine,
} from './engine-project.js';
import {
  EngineWorkflowClient,
  type AgentHarness,
  type Deployment,
  type DomainWorker,
  type WorkflowBlock,
} from './engine-workflow.js';
import {
  formatHttpErrorMessage,
  parseSseDataPayload,
  parseSseEventName,
  readApiResponse,
  readHealthResponse,
  scrubApiErrorMessage,
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
  /** user writable vs bundled catalog (v0.5.8). */
  source?: 'user' | 'bundled';
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

export interface SkillExampleCard {
  id?: string;
  key?: string;
  title?: string;
  path?: string;
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
  /** Package root label when skill is dir/SKILL.md layout (v0.5.7). */
  packageDir?: string;
  exampleCount?: number;
  /** Derived example cards (sanitized basenames). */
  examples?: SkillExampleCard[];
  assets?: string[];
  references?: string[];
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


export class EngineClient extends EngineWorkflowClient {
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

  async getSettings(): Promise<ApiResponse<Record<string, string>>> {
    const res = await fetch(`${this.baseUrl}/api/settings`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getSetting(key: string): Promise<ApiResponse<{ key: string; value: string }>> {
    const seg = this.settingKeySegment(key);
    if (!seg) return this.invalidIdResponse('setting key');
    const res = await fetch(`${this.baseUrl}/api/settings/${seg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async saveSetting(key: string, value: string): Promise<ApiResponse<void>> {
    const seg = this.settingKeySegment(key);
    if (!seg) return this.invalidIdResponse('setting key');
    const res = await fetch(`${this.baseUrl}/api/settings/${seg}`, {
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

  /**
   * POST /api/connection-test — probe provider / custom URL reachability (no secrets returned).
   * Targets: openai | anthropic | ollama | url | cli-agents.
   */
  async connectionTest(input: {
    target: 'openai' | 'anthropic' | 'ollama' | 'url' | 'cli-agents' | string;
    url?: string;
  }): Promise<
    ApiResponse<{
      target?: string;
      reachable?: boolean;
      blocked?: boolean;
      status?: number;
      message?: string;
      catalogCount?: number;
    }>
  > {
    if (
      !input
      || typeof input.target !== 'string'
      || /[\0\r\n]/.test(input.target)
      || !input.target.trim()
    ) {
      return { ok: false, error: 'Invalid target' };
    }
    const target = input.target.trim().toLowerCase();
    const allowed = new Set(['openai', 'anthropic', 'ollama', 'url', 'cli-agents']);
    if (!allowed.has(target)) {
      return { ok: false, error: 'Invalid target' };
    }
    const body: { target: string; url?: string } = { target };
    if (target === 'url') {
      if (typeof input.url !== 'string' || /[\0\r\n]/.test(input.url) || !input.url.trim()) {
        return { ok: false, error: 'Invalid url' };
      }
      body.url = input.url.trim().slice(0, 2_048);
    }
    const res = await fetch(`${this.baseUrl}/api/connection-test`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

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
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('skill id');
    const res = await fetch(`${this.baseUrl}/api/skills/${seg}/toggle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ enabled }),
    });
    return readApiResponse(res);
  }

  async deleteSkill(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('skill id');
    const res = await fetch(`${this.baseUrl}/api/skills/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async upgradeSkillToPlugin(skillId: string): Promise<ApiResponse<Plugin>> {
    // Validate skill id before body send (control-char / blank / traversal fail closed)
    const safeId = this.sanitizeId(skillId);
    if (!safeId) return this.invalidIdResponse('skill id');
    const res = await fetch(`${this.baseUrl}/api/plugins/upgrade-from-skill`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillId: safeId }),
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

  /** GET /api/mcp-servers/presets — built-in one-click MCP catalogs. */
  async listMcpPresets(): Promise<
    ApiResponse<
      Array<{
        id: string;
        name: string;
        domain?: string;
        description?: string;
        toolHints?: string[];
      }>
    >
  > {
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/presets`, {
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
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('MCP server id');
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/${seg}/toggle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ enabled }),
    });
    return readApiResponse(res);
  }

  async deleteMcpServer(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('MCP server id');
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/${seg}`, {
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
    const seg = this.pathSegment(serverId);
    if (!seg) return this.invalidIdResponse('MCP server id');
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/oauth/${seg}/status`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async revokeMcpOAuth(serverId: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(serverId);
    if (!seg) return this.invalidIdResponse('MCP server id');
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/oauth/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getMcpInstallInfo(query?: {
    projectId?: string;
    includeToken?: boolean;
  }): Promise<
    ApiResponse<{
      serverName?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      shellSnippet?: string;
      codexAddCommand?: string;
      codexRemoveCommand?: string;
      claudeDesktop?: unknown;
      tools?: Array<{ name: string; description?: string }>;
      notes?: string[];
      version?: string;
    }>
  > {
    const qs = new URLSearchParams();
    if (query?.projectId && !/[\0\r\n]/.test(query.projectId)) {
      const p = query.projectId.trim().slice(0, 100);
      if (p) qs.set('projectId', p);
    }
    if (query?.includeToken === false) qs.set('includeToken', '0');
    const q = qs.toString();
    const res = await fetch(`${this.baseUrl}/api/mcp/install-info${q ? `?${q}` : ''}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getCodexMcpInstallStatus(): Promise<
    ApiResponse<{
      available: boolean;
      installed: boolean;
      codexPath: string | null;
      detail: string | null;
    }>
  > {
    const res = await fetch(`${this.baseUrl}/api/mcp/install/codex/status`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async installCodexMcp(params?: {
    projectId?: string;
    neosBin?: string;
  }): Promise<ApiResponse<{ installed?: boolean; command?: string; stdout?: string; serverName?: string }>> {
    const body: Record<string, string> = {};
    if (params?.projectId && !/[\0\r\n]/.test(params.projectId)) {
      const p = params.projectId.trim().slice(0, 100);
      if (p) body.projectId = p;
    }
    if (params?.neosBin && !/[\0\r\n]/.test(params.neosBin)) {
      const b = params.neosBin.trim().slice(0, 4096);
      if (b) body.neosBin = b;
    }
    const res = await fetch(`${this.baseUrl}/api/mcp/install/codex`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  async uninstallCodexMcp(): Promise<ApiResponse<{ removed?: boolean; stdout?: string }>> {
    const res = await fetch(`${this.baseUrl}/api/mcp/install/codex`, {
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
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getDesignSystemContent(id: string): Promise<ApiResponse<{ content: string }>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}/content`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async getDesignSystemTokens(id: string): Promise<ApiResponse<{ content: string }>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}/tokens`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async saveDesignSystemContent(id: string, content: string): Promise<ApiResponse<null>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('design system id');
    const res = await fetch(`${this.baseUrl}/api/design-systems/${seg}/content`, {
      method: 'PUT',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    return readApiResponse(res);
  }

  // --- Artifacts ---

  async listArtifacts(params: { workflowId?: string; runId?: string }): Promise<ApiResponse<Artifact[]>> {
    if (params.runId) {
      const seg = this.pathSegment(params.runId);
      if (!seg) return this.invalidIdResponse('run id');
      const res = await fetch(`${this.baseUrl}/api/artifacts?runId=${seg}`, { headers: this.getHeaders() });
      return readApiResponse(res);
    }
    if (params.workflowId) {
      const seg = this.pathSegment(params.workflowId);
      if (!seg) return this.invalidIdResponse('workflow id');
      const res = await fetch(`${this.baseUrl}/api/artifacts?workflowId=${seg}`, {
        headers: this.getHeaders(),
      });
      return readApiResponse(res);
    }
    return this.invalidIdResponse('workflow id');
  }

  async getArtifact(id: string): Promise<ApiResponse<Artifact>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('artifact id');
    const res = await fetch(`${this.baseUrl}/api/artifacts/${seg}`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async refreshArtifact(
    id: string,
    mode: 'reload' | 'rerun' = 'reload',
  ): Promise<ApiResponse<Artifact> & { meta?: { mode?: string; workflowId?: string; nodeId?: string; message?: string } }> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('artifact id');
    const res = await fetch(`${this.baseUrl}/api/artifacts/${seg}/refresh`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    return readApiResponse(res);
  }

  async deleteArtifact(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('artifact id');
    const res = await fetch(`${this.baseUrl}/api/artifacts/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async updateArtifact(
    id: string,
    input: { name?: string; content?: string },
  ): Promise<ApiResponse<Artifact>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('artifact id');
    const res = await fetch(`${this.baseUrl}/api/artifacts/${seg}`, {
      method: 'PATCH',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteMediaFile(filename: string): Promise<ApiResponse<void>> {
    const seg = this.mediaFilenameSegment(filename);
    if (!seg) return this.invalidIdResponse('media filename');
    const res = await fetch(`${this.baseUrl}/api/media/file/${seg}`, {
      method: 'DELETE',
      headers: this.mediaAuthHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Routines ---

  async listRoutines(): Promise<ApiResponse<Routine[]>> {
    const res = await fetch(`${this.baseUrl}/api/routines`, { headers: this.getHeaders() });
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
    const safeWorkflowId = this.sanitizeId(input.workflowId);
    if (!safeWorkflowId) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/routines`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, workflowId: safeWorkflowId }),
    });
    return readApiResponse(res);
  }

  async updateRoutine(id: string, input: Partial<{ name: string; schedule: string; timezone: string; enabled: boolean; inputs: Record<string, unknown> }>): Promise<ApiResponse<Routine>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('routine id');
    const res = await fetch(`${this.baseUrl}/api/routines/${seg}`, {
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

  /**
   * POST /api/media/generate — unified image | audio | video generation.
   * Image/video use `prompt`; audio uses `text` (mirrors CLI `neos media generate`).
   * Video may return `{ jobId, status }` for async polling via `getMediaJob`.
   */
  async generateMedia(input: {
    surface: 'image' | 'audio' | 'video';
    prompt?: string;
    text?: string;
    provider?: string;
    model?: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  }): Promise<
    ApiResponse<{
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
      return { ok: false, error: 'surface must be image, audio, or video' };
    }
    const body: Record<string, string> = { surface };
    if (surface === 'audio') {
      const text = typeof input.text === 'string' ? input.text : input.prompt;
      if (typeof text !== 'string' || /\0/.test(text) || !text.trim()) {
        return { ok: false, error: 'text required for audio' };
      }
      body.text = text.trim();
    } else {
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      if (!prompt.trim() || /[\0\r\n]/.test(prompt)) {
        return { ok: false, error: 'prompt required (no control characters)' };
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

    const res = await fetch(`${this.baseUrl}/api/media/generate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  // --- Live artifacts (Task 9) ---

  async listLiveArtifacts(projectId: string): Promise<ApiResponse<LiveArtifact[]>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    const res = await fetch(
      `${this.baseUrl}/api/live-artifacts?projectId=${encodeURIComponent(seg)}`,
      { headers: this.getHeaders() },
    );
    return readApiResponse(res);
  }

  async createLiveArtifact(input: {
    projectId: string;
    name: string;
    sourceTemplate?: string;
    inputs?: Record<string, unknown>;
    contentType?: string;
  }): Promise<ApiResponse<LiveArtifact>> {
    const seg = this.pathSegment(input.projectId);
    if (!seg) return this.invalidIdResponse('project id');
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name) || !input.name.trim()) {
      return { ok: false, error: 'Invalid name' };
    }
    const res = await fetch(`${this.baseUrl}/api/live-artifacts`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        projectId: seg,
        name: input.name.trim(),
        sourceTemplate: input.sourceTemplate,
        inputs: input.inputs,
        contentType: input.contentType,
      }),
    });
    return readApiResponse(res);
  }

  async refreshLiveArtifact(
    id: string,
    projectId: string,
    inputs?: Record<string, unknown>,
  ): Promise<ApiResponse<{ artifact: LiveArtifact; refresh: LiveArtifactRefresh }>> {
    const aid = this.pathSegment(id);
    const pid = this.pathSegment(projectId);
    if (!aid || !pid) return this.invalidIdResponse('id');
    const res = await fetch(
      `${this.baseUrl}/api/live-artifacts/${aid}/refresh?projectId=${encodeURIComponent(pid)}`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(inputs ? { inputs } : {}),
      },
    );
    return readApiResponse(res);
  }

  async deleteLiveArtifact(id: string, projectId: string): Promise<ApiResponse<null>> {
    const aid = this.pathSegment(id);
    const pid = this.pathSegment(projectId);
    if (!aid || !pid) return this.invalidIdResponse('id');
    const res = await fetch(
      `${this.baseUrl}/api/live-artifacts/${aid}?projectId=${encodeURIComponent(pid)}`,
      { method: 'DELETE', headers: this.getHeaders() },
    );
    return readApiResponse(res);
  }
  async getMediaConfig(): Promise<
    ApiResponse<{
      openaiConfigured: boolean;
      openaiBaseUrl: string | null;
      surfaces: string[];
      imageModels: string[];
      audioModels: string[];
      videoModels?: string[];
      stubsAllowed?: boolean;
      providers?: Array<{
        id: string;
        label: string;
        surfaces: string[];
        configured: boolean;
        isStub?: boolean;
      }>;
    }>
  > {
    const res = await fetch(`${this.baseUrl}/api/media/config`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async listMediaProviders(): Promise<
    ApiResponse<
      Array<{
        id: string;
        label: string;
        surfaces: string[];
        configured: boolean;
        isStub?: boolean;
      }>
    >
  > {
    const res = await fetch(`${this.baseUrl}/api/media/providers`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getMediaJob(
    id: string,
  ): Promise<
    ApiResponse<{
      id: string;
      surface: string;
      provider: string;
      status: string;
      filename?: string;
      error?: string;
    }>
  > {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('job id');
    const res = await fetch(`${this.baseUrl}/api/media/jobs/${seg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }
  async fetchMediaBlob(filename: string): Promise<Blob> {
    const seg = this.mediaFilenameSegment(filename);
    if (!seg) throw new Error('Invalid media filename');
    const res = await fetch(`${this.baseUrl}/api/media/file/${seg}`, {
      headers: this.mediaAuthHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to load media (${res.status})`);
    return res.blob();
  }

  async refreshDeployment(id: string): Promise<ApiResponse<Deployment>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('deployment id');
    const res = await fetch(`${this.baseUrl}/api/deploy/${seg}/refresh`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async deleteRoutine(id: string): Promise<ApiResponse<null>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('routine id');
    const res = await fetch(`${this.baseUrl}/api/routines/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async runRoutineNow(id: string): Promise<ApiResponse<{ runId: string }>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('routine id');
    const res = await fetch(`${this.baseUrl}/api/routines/${seg}/run`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async listRoutineRuns(id: string): Promise<ApiResponse<RoutineRun[]>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('routine id');
    const res = await fetch(`${this.baseUrl}/api/routines/${seg}/runs`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async crystallizeRoutineRun(
    routineId: string,
    runId: string,
    input?: { name?: string; description?: string },
  ): Promise<ApiResponse<{ skillId: string; name: string; path: string }>> {
    const rseg = this.pathSegment(routineId);
    if (!rseg) return this.invalidIdResponse('routine id');
    const runSeg = this.pathSegment(runId);
    if (!runSeg) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/routines/${rseg}/runs/${runSeg}/crystallize`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(input ?? {}),
    });
    return readApiResponse(res);
  }

  async deployPreflight(provider: 'vercel' | 'cloudflare', projectName?: string): Promise<
    ApiResponse<{
      provider: string;
      ready: boolean;
      checks: Array<{ key: string; ok: boolean; message: string; severity?: string }>;
    }>
  > {
    const res = await fetch(`${this.baseUrl}/api/deploy/preflight`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, projectName }),
    });
    return readApiResponse(res);
  }

  /** Check public deployment URL reachability (Task 10). */
  async checkDeployLink(url: string): Promise<
    ApiResponse<{
      url: string;
      reachable: boolean;
      blocked: boolean;
      ok: boolean;
      status?: number;
      reason?: string;
      contentType?: string;
    }>
  > {
    if (typeof url !== 'string' || /[\0\r\n]/.test(url) || !url.trim()) {
      return { ok: false, error: 'Invalid url' };
    }
    const res = await fetch(`${this.baseUrl}/api/deploy/check-link`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    });
    return readApiResponse(res);
  }

  async getMarketplaceCatalogUrl(): Promise<ApiResponse<{ url: string | null }>> {
    const res = await fetch(`${this.baseUrl}/api/marketplace/catalog-url`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async setMarketplaceCatalogUrl(url: string): Promise<ApiResponse<{ url: string | null }>> {
    const res = await fetch(`${this.baseUrl}/api/marketplace/catalog-url`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ url }),
    });
    return readApiResponse(res);
  }

  async fetchMarketplaceCatalog(url?: string): Promise<
    ApiResponse<{
      schemaVersion: string;
      name?: string;
      entries: Array<{
        id: string;
        name: string;
        description?: string;
        version: string;
        trust: string;
        packageUrl: string;
        sha256?: string;
      }>;
      sourceUrl: string;
    }>
  > {
    const qs =
      url && typeof url === 'string' && !/[\0\r\n]/.test(url)
        ? `?url=${encodeURIComponent(url.trim())}`
        : '';
    const res = await fetch(`${this.baseUrl}/api/marketplace/catalog${qs}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async installMarketplaceEntry(input: {
    id?: string;
    url?: string;
    entry?: {
      id: string;
      name: string;
      version: string;
      trust: string;
      packageUrl: string;
      sha256?: string;
      description?: string;
    };
  }): Promise<ApiResponse<{ id: string; version: string; trust: string; message: string }>> {
    const res = await fetch(`${this.baseUrl}/api/marketplace/install`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  // --- Plugins ---

  async listPlugins(): Promise<ApiResponse<Plugin[]> & { meta?: PluginListMeta }> {
    const res = await fetch(`${this.baseUrl}/api/plugins`, { headers: this.getHeaders() });
    return readApiResponse(res) as Promise<ApiResponse<Plugin[]> & { meta?: PluginListMeta }>;
  }

  runPlugin(
    id: string,
    inputs: Record<string, unknown>,
    onEvent: (event: unknown) => void,
  ): { stop: () => void; runIdPromise: Promise<string | null> } {
    const controller = new AbortController();
    const runIdPromise = (async () => {
      try {
        const seg = this.pathSegment(id);
        if (!seg) {
          onEvent({ type: 'error', error: 'Invalid plugin id' });
          return null;
        }
        const res = await fetch(`${this.baseUrl}/api/plugins/${seg}/run`, {
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
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('plugin id');
    const runSeg = this.pathSegment(runId);
    if (!runSeg) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/plugins/${seg}/run/${runSeg}/resume`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ stageId, response }),
    });
    return readApiResponse(res);
  }

  // --- Workers (v0.4) / Harnesses (deprecated alias) ---

  async listWorkers(domain?: string): Promise<ApiResponse<AgentHarness[]>> {
    const q =
      typeof domain === 'string' && domain.trim() && !/[\0\r\n]/.test(domain)
        ? `?domain=${encodeURIComponent(domain.trim().toLowerCase())}`
        : '';
    const res = await fetch(`${this.baseUrl}/api/workers${q}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async listDomainPacks(): Promise<
    ApiResponse<
      Array<{
        id: string;
        name: string;
        description?: string;
        workerCount?: number;
        blockCount?: number;
        isBuiltIn?: boolean;
        enabled?: boolean;
        version?: string;
        sourcePath?: string;
        icon?: string;
      }>
    >
  > {
    const res = await fetch(`${this.baseUrl}/api/domain-packs`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }
  async installDomainPackFromPath(dirPath: string): Promise<ApiResponse<Record<string, unknown>>> {
    if (typeof dirPath !== 'string' || /[\0\r\n]/.test(dirPath) || !dirPath.trim()) {
      return { ok: false, error: 'Invalid path' };
    }
    const res = await fetch(`${this.baseUrl}/api/domain-packs/install`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ path: dirPath.trim() }),
    });
    return readApiResponse(res);
  }

  /**
   * POST /api/domain-packs/install-zip — multipart `file` (or raw zip).
   * Max ~10 MiB (server DOMAIN_PACK_ZIP_MAX_BYTES).
   */
  async installDomainPackFromZip(
    zip: Blob | File,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    try {
      if (!zip || typeof (zip as Blob).size !== 'number') {
        return { ok: false, error: 'Invalid zip' };
      }
      if (zip.size <= 0) return { ok: false, error: 'Empty zip' };
      if (zip.size > 10 * 1024 * 1024) return { ok: false, error: 'zip too large' };
      const form = new FormData();
      const name =
        zip instanceof File && typeof zip.name === 'string' && zip.name.trim()
          ? zip.name.replace(/[\0\r\n]/g, '_').slice(0, 200)
          : 'pack.zip';
      form.append('file', zip, name);
      // Auth only — browser sets multipart boundary
      const headers = { ...this.getHeaders() };
      delete headers['Content-Type'];
      const res = await fetch(`${this.baseUrl}/api/domain-packs/install-zip`, {
        method: 'POST',
        headers,
        body: form,
      });
      return readApiResponse(res);
    } catch (err) {
      return {
        ok: false,
        error: scrubApiErrorMessage(
          err instanceof Error ? err.message : 'Install failed',
          'Install failed',
        ),
      };
    }
  }

  /**
   * POST /api/domain-packs/validate — parse pack.json / manifest without installing.
   */
  async validateDomainPackManifest(
    manifest: unknown,
  ): Promise<
    ApiResponse<{
      id?: string;
      name?: string;
      workerCount?: number;
      blockCount?: number;
      version?: string;
    }>
  > {
    if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { ok: false, error: 'Invalid manifest' };
    }
    const res = await fetch(`${this.baseUrl}/api/domain-packs/validate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ manifest }),
    });
    return readApiResponse(res);
  }

  async getDomainPack(id: string): Promise<ApiResponse<Record<string, unknown>>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('pack id');
    const res = await fetch(`${this.baseUrl}/api/domain-packs/${seg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async toggleDomainPack(
    id: string,
    enabled: boolean,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('pack id');
    const res = await fetch(`${this.baseUrl}/api/domain-packs/${seg}/toggle`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ enabled }),
    });
    return readApiResponse(res);
  }

  async deleteDomainPack(id: string): Promise<ApiResponse<unknown>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('pack id');
    const res = await fetch(`${this.baseUrl}/api/domain-packs/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async createWorker(
    input: Omit<DomainWorker, 'id' | 'isBuiltIn'> & { id?: string },
  ): Promise<ApiResponse<DomainWorker>> {
    const res = await fetch(`${this.baseUrl}/api/workers`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async updateWorker(id: string, input: Partial<DomainWorker>): Promise<ApiResponse<DomainWorker>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('worker id');
    const res = await fetch(`${this.baseUrl}/api/workers/${seg}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteWorker(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('worker id');
    const res = await fetch(`${this.baseUrl}/api/workers/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /**
   * @deprecated Prefer listWorkers.
   * Thin alias — `/api/harness` HTTP routes were removed in 0.10.2 (410 Gone).
   */
  async listHarnesses(): Promise<ApiResponse<AgentHarness[]>> {
    return this.listWorkers();
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
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('block id');
    const res = await fetch(`${this.baseUrl}/api/blocks/${seg}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteBlock(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('block id');
    const res = await fetch(`${this.baseUrl}/api/blocks/${seg}`, {
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
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('memory id');
    const res = await fetch(`${this.baseUrl}/api/memory/${seg}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteMemory(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('memory id');
    const res = await fetch(`${this.baseUrl}/api/memory/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async toggleMemory(id: string): Promise<ApiResponse<MemoryItem>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('memory id');
    const res = await fetch(`${this.baseUrl}/api/memory/${seg}/toggle`, {
      method: 'PUT',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }
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


