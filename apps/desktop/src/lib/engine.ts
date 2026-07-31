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
  /** user writable vs bundled catalog (v0.5.8). */
  source?: 'user' | 'bundled';
  createdAt: string;
  updatedAt: string;
}

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

export class EngineClient {
  private baseUrl: string;
  private authToken: string | null = null;

  constructor(baseUrl: string) {
    // Control-char / non-string base URLs rejected (fetch / log hygiene)
    if (typeof baseUrl !== 'string' || /[\0\r\n]/.test(baseUrl)) {
      this.baseUrl = '';
      return;
    }
    // Trim and strip trailing slashes so `${base}/api/...` joins cleanly
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    this.baseUrl = trimmed;
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

  /**
   * Sanitize an entity id for API use (body or path).
   * Rejects control-char / blank / overlong / path separators / `.` / `..`.
   * Returns the trimmed raw string when valid (callers fail closed on '').
   */
  private sanitizeId(raw: unknown, maxChars = 200): string {
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
    const s = raw.trim();
    if (!s || s.length > maxChars) return '';
    // Path separators and bare relative segments never allowed in ids
    if (s.includes('/') || s.includes('\\') || s === '.' || s === '..') return '';
    return s;
  }

  /**
   * Sanitize + encode a path-segment id for URL construction.
   * Returns empty string when invalid (callers fail closed).
   */
  private pathSegment(raw: unknown, maxChars = 200): string {
    const s = this.sanitizeId(raw, maxChars);
    return s ? encodeURIComponent(s) : '';
  }

  /**
   * Settings key path segment (align with server paramSettingKey).
   * Alphanumeric / underscore / hyphen / dot; max 100 chars.
   */
  private settingKeySegment(raw: unknown): string {
    const s = this.sanitizeId(raw, 100);
    if (!s || !/^[a-zA-Z0-9_.-]+$/.test(s)) return '';
    return encodeURIComponent(s);
  }

  /**
   * Media filename path segment (align with server isSafeMediaFilename).
   * Alphanumeric / underscore / hyphen / dot only; no leading dots.
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

  /** Authorization-only headers for binary media fetch/delete (control-char safe). */
  private mediaAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (
      this.authToken
      && typeof this.authToken === 'string'
      && !/[\0\r\n]/.test(this.authToken)
      && this.authToken.trim()
    ) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  private invalidIdResponse<T = unknown>(label = 'id'): ApiResponse<T> {
    return { ok: false, error: `Invalid ${label}` } as ApiResponse<T>;
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
    const wid = this.pathSegment(id);
    if (!wid) return this.invalidIdResponse('workspace id');
    const res = await fetch(`${this.baseUrl}/api/workspace/${wid}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    return readApiResponse(res);
  }

  async deleteWorkspace(id: string): Promise<ApiResponse<void>> {
    const wid = this.pathSegment(id);
    if (!wid) return this.invalidIdResponse('workspace id');
    const res = await fetch(`${this.baseUrl}/api/workspace/${wid}`, {
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

  async refreshMcpOAuth(serverId: string, params: { tokenEndpoint: string; clientId: string }): Promise<ApiResponse<{ connected: boolean; expiresAt?: string }>> {
    const seg = this.pathSegment(serverId);
    if (!seg) return this.invalidIdResponse('MCP server id');
    const res = await fetch(`${this.baseUrl}/api/mcp-servers/oauth/${seg}/refresh`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(params),
    });
    return readApiResponse(res);
  }

  // --- NEOS as MCP server (Task 16 / OD §14.3–14.4) ---

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

  async listNeosMcpTools(): Promise<
    ApiResponse<Array<{ name: string; description?: string; inputSchema?: unknown }>>
  > {
    const res = await fetch(`${this.baseUrl}/api/mcp/tools`, {
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

  // --- Design Projects (v0.5) ---

  /**
   * Encode a project-relative file path for `/files/*` splat routes.
   * Rejects absolute paths, `..`, control chars; encodes each segment.
   */
  private projectRelPathSegments(raw: unknown, maxChars = 1_000): string {
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
   * Project file SSE (`file.changed` / `file.created` / `file.deleted`).
   * Returns abort callback. Uses fetch + Bearer (not EventSource).
   */
  streamProjectFileEvents(
    projectId: string,
    onEvent: (event: {
      type: string;
      projectId?: string;
      path?: string;
      source?: string;
      hash?: string;
      ts?: string;
    }) => void,
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
  ): Promise<ApiResponse<{ path: string; content: string; hash: string }>> {
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
  ): Promise<ApiResponse<{ path: string; hash: string; bytes: number; created: boolean }>> {
    const seg = this.pathSegment(projectId);
    const pathSeg = this.projectRelPathSegments(filePath);
    if (!seg) return this.invalidIdResponse('project id');
    if (!pathSeg) return this.invalidIdResponse('file path');
    if (typeof content !== 'string' || /\0/.test(content)) {
      return { ok: false, error: 'Invalid content' };
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/files/${pathSeg}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ content, source }),
    });
    return readApiResponse(res);
  }

  async mkdirProjectPath(
    projectId: string,
    dirPath: string,
  ): Promise<ApiResponse<{ path: string }>> {
    const seg = this.pathSegment(projectId);
    if (!seg) return this.invalidIdResponse('project id');
    if (typeof dirPath !== 'string' || /[\0\r\n]/.test(dirPath) || !dirPath.trim()) {
      return this.invalidIdResponse('path');
    }
    const res = await fetch(`${this.baseUrl}/api/projects/${seg}/mkdir`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ path: dirPath.trim() }),
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

  async restoreProjectRevision(
    projectId: string,
    revisionId: string,
  ): Promise<ApiResponse<{ path: string; hash: string }>> {
    const pSeg = this.pathSegment(projectId);
    const rSeg = this.pathSegment(revisionId);
    if (!pSeg) return this.invalidIdResponse('project id');
    if (!rSeg) return this.invalidIdResponse('revision id');
    const res = await fetch(
      `${this.baseUrl}/api/projects/${pSeg}/revisions/${rSeg}/restore`,
      { method: 'POST', headers: this.getHeaders() },
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

  // --- Project runs (v0.5 agent-runtime) ---

  async listProjectRuns(projectId?: string): Promise<
    ApiResponse<
      Array<{
        id: string;
        status: string;
        agentId?: string | null;
        projectId?: string | null;
        prompt?: string;
        error?: string | null;
        createdAt: string;
        eventCount?: number;
      }>
    >
  > {
    let qs = '';
    if (projectId != null && projectId !== '') {
      const seg = this.pathSegment(projectId);
      if (!seg) return this.invalidIdResponse('project id');
      qs = `?projectId=${seg}`;
    }
    const res = await fetch(`${this.baseUrl}/api/runs${qs}`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async createProjectRun(input: {
    projectId?: string;
    agentId?: string | null;
    prompt: string;
    editContext?: unknown;
    dryRun?: boolean;
    execute?: boolean;
  }): Promise<
    ApiResponse<{
      id: string;
      status: string;
      agentId?: string | null;
      projectId?: string | null;
      prompt?: string;
      error?: string | null;
      createdAt: string;
    }>
  > {
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
    const body: Record<string, unknown> = {
      prompt: input.prompt,
    };
    if (input.projectId) body.projectId = input.projectId.trim();
    if (input.agentId) body.agentId = input.agentId.trim();
    if (input.editContext != null) body.editContext = input.editContext;
    if (input.dryRun === true) body.dryRun = true;
    if (input.execute === false) body.execute = false;

    const res = await fetch(`${this.baseUrl}/api/runs`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  async getProjectRun(runId: string): Promise<
    ApiResponse<{
      id: string;
      status: string;
      agentId?: string | null;
      projectId?: string | null;
      prompt?: string;
      error?: string | null;
      eventCount?: number;
    }>
  > {
    const seg = this.pathSegment(runId);
    if (!seg) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/runs/${seg}`, { headers: this.getHeaders() });
    return readApiResponse(res);
  }

  async listProjectRunEvents(
    runId: string,
    after?: string,
  ): Promise<ApiResponse<Array<{ id: string; type: string; ts: string; data?: unknown }>>> {
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

  async cancelProjectRun(runId: string): Promise<ApiResponse<{ id: string; status: string }>> {
    const seg = this.pathSegment(runId);
    if (!seg) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/runs/${seg}/cancel`, {
      method: 'POST',
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

  async getRoutine(id: string): Promise<ApiResponse<Routine>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('routine id');
    const res = await fetch(`${this.baseUrl}/api/routines/${seg}`, { headers: this.getHeaders() });
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

  async createProjectToolToken(
    projectId: string,
    opts?: { capabilities?: string[]; runId?: string },
  ): Promise<
    ApiResponse<{
      token: string;
      projectId: string;
      capabilities: string[];
      expiresAt: string;
    }>
  > {
    const pid = this.pathSegment(projectId);
    if (!pid) return this.invalidIdResponse('project id');
    const res = await fetch(`${this.baseUrl}/api/live-artifacts/tool-tokens`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        projectId: pid,
        capabilities: opts?.capabilities ?? ['live-artifacts'],
        runId: opts?.runId,
      }),
    });
    return readApiResponse(res);
  }

  /** Media generation readiness (no secrets returned). Task 8 multi-provider. */
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

  mediaFileUrl(filename: string): string {
    const seg = this.mediaFilenameSegment(filename);
    if (!seg) return '';
    return `${this.baseUrl}/api/media/file/${seg}`;
  }

  /** Authenticated fetch of a media file as Blob (for FileViewer). */
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

  /** Provider / URL connectivity probe (Task 14) — no secrets returned. */
  async connectionTest(input: {
    target: 'openai' | 'anthropic' | 'ollama' | 'url' | 'cli-agents';
    url?: string;
  }): Promise<
    ApiResponse<{
      target: string;
      reachable: boolean;
      blocked?: boolean;
      status?: number;
      message?: string;
      catalogCount?: number;
    }>
  > {
    if (!input?.target || /[\0\r\n]/.test(input.target)) {
      return { ok: false, error: 'Invalid target' };
    }
    const res = await fetch(`${this.baseUrl}/api/connection-test`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: input.target,
        url: input.url,
      }),
    });
    return readApiResponse(res);
  }

  // --- Plugins ---

  async listPlugins(): Promise<ApiResponse<Plugin[]> & { meta?: PluginListMeta }> {
    const res = await fetch(`${this.baseUrl}/api/plugins`, { headers: this.getHeaders() });
    return readApiResponse(res) as Promise<ApiResponse<Plugin[]> & { meta?: PluginListMeta }>;
  }

  async getPlugin(id: string): Promise<ApiResponse<Plugin>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('plugin id');
    const res = await fetch(`${this.baseUrl}/api/plugins/${seg}`, { headers: this.getHeaders() });
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

  // --- Workflows ---

  async listWorkflows(): Promise<ApiResponse<Workflow[]>> {
    const res = await fetch(`${this.baseUrl}/api/workflow`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getWorkflow(id: string): Promise<ApiResponse<Workflow>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async createWorkflow(input: {
    name: string;
    description?: string;
    /** @deprecated Prefer primaryDomain (v0.4 Q2). Still accepted by server. */
    domain?: string;
    /** Primary domain pack id (API/JSON v2 field). */
    primaryDomain?: string;
    domainPackIds?: string[];
    nodes?: unknown[];
    edges?: unknown[];
  }): Promise<ApiResponse<Workflow>> {
    // Prefer primaryDomain when only domain is set (v2 client shape)
    const body = {
      ...input,
      primaryDomain:
        typeof input.primaryDomain === 'string' && input.primaryDomain.trim()
          ? input.primaryDomain.trim()
          : typeof input.domain === 'string' && input.domain.trim()
            ? input.domain.trim()
            : undefined,
    };
    const res = await fetch(`${this.baseUrl}/api/workflow`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });
    return readApiResponse(res);
  }

  async updateWorkflow(
    id: string,
    input: {
      name?: string;
      description?: string;
      designSystemId?: string;
      domain?: string;
      primaryDomain?: string;
      domainPackIds?: string[] | null;
      nodes?: unknown[];
      edges?: unknown[];
    },
  ): Promise<ApiResponse<Workflow>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(input),
    });
    return readApiResponse(res);
  }

  async deleteWorkflow(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async duplicateWorkflow(id: string): Promise<ApiResponse<Workflow>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/duplicate`, {
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
    const seg = this.pathSegment(id);
    if (!seg) return false;
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/export`, {
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
    const seg = this.pathSegment(id);
    if (!seg) return false;
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/export.zip`, {
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
      const seg = this.pathSegment(id);
      if (!seg) {
        onEvent({ type: 'run.failed', runId: '', error: 'Invalid workflow id' });
        return;
      }
      const body = inputs ? JSON.stringify({ inputs }) : undefined;
      const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/run`, {
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
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/runs?limit=${limit}&offset=${offset}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getWorkflowRun(workflowId: string, runId: string): Promise<ApiResponse<WorkflowRun>> {
    const seg1 = this.pathSegment(workflowId);
    const seg2 = this.pathSegment(runId);
    if (!seg1) return this.invalidIdResponse('workflow id');
    if (!seg2) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg1}/runs/${seg2}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async deleteWorkflowRun(workflowId: string, runId: string): Promise<ApiResponse<void>> {
    const seg1 = this.pathSegment(workflowId);
    if (!seg1) return this.invalidIdResponse('workflow id');
    const seg2 = this.pathSegment(runId);
    if (!seg2) return this.invalidIdResponse('run id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg1}/runs/${seg2}`, {
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
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/runs${qs}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async preflightWorkflow(workflowId: string): Promise<ApiResponse<{
    ok: boolean;
    issues: Array<{ code: string; severity: 'error' | 'warning'; message: string; nodeId?: string }>;
  }>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow/${seg}/preflight`, {
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
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/webhook/${seg}/secret`, {
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
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/webhook/${seg}/rate-limit`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async regenerateWebhookSecret(workflowId: string): Promise<ApiResponse<{ secret: string }>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/webhook/${seg}/regenerate`, {
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
    const seg = this.pathSegment(workflowId);
    if (!seg) return { ok: false, status: 0, error: 'Invalid workflow id' };
    const secretRes = await this.getWebhookSecret(workflowId);
    if (!secretRes.ok || !secretRes.data?.secret) {
      return { ok: false, status: 0, error: 'Failed to load webhook secret' };
    }
    const { hmacSha256Hex } = await import('./hmac.js');
    const raw = JSON.stringify(body);
    const sig = await hmacSha256Hex(secretRes.data.secret, raw);
    const res = await fetch(`${this.baseUrl}/api/webhook/${seg}`, {
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
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${seg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getRevision(workflowId: string, revisionId: string): Promise<ApiResponse<WorkflowRevision>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const rev = this.pathSegment(revisionId);
    if (!rev) return this.invalidIdResponse('revision id');
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${seg}/${rev}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Persist a revision snapshot onto the workflow record (plan Task 16). */
  async restoreRevision(
    workflowId: string,
    revisionId: string,
  ): Promise<ApiResponse<Workflow> & { meta?: { restoredFrom?: string; label?: string } }> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const rev = this.pathSegment(revisionId);
    if (!rev) return this.invalidIdResponse('revision id');
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${seg}/${rev}/restore`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async updateRevisionLabel(workflowId: string, revisionId: string, label: string): Promise<ApiResponse<WorkflowRevision>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const rev = this.pathSegment(revisionId);
    if (!rev) return this.invalidIdResponse('revision id');
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${seg}/${rev}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ label }),
    });
    return readApiResponse(res);
  }

  async deleteRevision(workflowId: string, revisionId: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(workflowId);
    if (!seg) return this.invalidIdResponse('workflow id');
    const rev = this.pathSegment(revisionId);
    if (!rev) return this.invalidIdResponse('revision id');
    const res = await fetch(`${this.baseUrl}/api/workflow-revisions/${seg}/${rev}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  // --- Deployments ---

  async listDeployments(
    workflowId?: string,
    limit = 100,
    projectId?: string,
  ): Promise<ApiResponse<Deployment[]>> {
    const params = new URLSearchParams();
    if (workflowId) {
      const safeId = this.sanitizeId(workflowId);
      if (!safeId) return this.invalidIdResponse('workflow id');
      params.set('workflowId', safeId);
    }
    if (projectId) {
      const safePid = this.sanitizeId(projectId);
      if (!safePid) return this.invalidIdResponse('project id');
      params.set('projectId', safePid);
    }
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    const res = await fetch(`${this.baseUrl}/api/deploy${qs ? `?${qs}` : ''}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async getDeployment(id: string): Promise<ApiResponse<Deployment>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('deployment id');
    const res = await fetch(`${this.baseUrl}/api/deploy/${seg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  async deleteDeployment(id: string): Promise<ApiResponse<void>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('deployment id');
    const res = await fetch(`${this.baseUrl}/api/deploy/${seg}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
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

  async getDomainPack(id: string): Promise<ApiResponse<Record<string, unknown>>> {
    const seg = this.pathSegment(id);
    if (!seg) return this.invalidIdResponse('pack id');
    const res = await fetch(`${this.baseUrl}/api/domain-packs/${seg}`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** Install a Domain Pack from a local directory containing pack.json. */
  async installDomainPackFromPath(dirPath: string): Promise<ApiResponse<Record<string, unknown>>> {
    const res = await fetch(`${this.baseUrl}/api/domain-packs/install`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ path: dirPath }),
    });
    return readApiResponse(res);
  }

  async validateDomainPackManifest(
    manifest: unknown,
  ): Promise<ApiResponse<{ id: string; name: string; workerCount: number; blockCount: number }>> {
    const res = await fetch(`${this.baseUrl}/api/domain-packs/validate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(manifest),
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

  /** @deprecated Prefer listWorkers */
  async listHarnesses(): Promise<ApiResponse<AgentHarness[]>> {
    // Prefer workers API; fall back to harness alias for older servers
    try {
      const primary = await this.listWorkers();
      if (primary.ok) return primary;
    } catch {
      // fall through
    }
    const res = await fetch(`${this.baseUrl}/api/harness`, {
      headers: this.getHeaders(),
    });
    return readApiResponse(res);
  }

  /** @deprecated Prefer createWorker — routes to `/api/workers`. */
  async createHarness(input: Omit<AgentHarness, 'isBuiltIn'>): Promise<ApiResponse<AgentHarness>> {
    return this.createWorker(input);
  }

  /** @deprecated Prefer updateWorker — routes to `/api/workers`. */
  async updateHarness(id: string, input: Partial<AgentHarness>): Promise<ApiResponse<AgentHarness>> {
    return this.updateWorker(id, input);
  }

  /** @deprecated Prefer deleteWorker — routes to `/api/workers`. */
  async deleteHarness(id: string): Promise<ApiResponse<void>> {
    return this.deleteWorker(id);
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

// Local type mirrors (aligned with @neos-work/shared NodeType / Workflow)
export type WorkflowNodeType =
  | 'trigger'
  | 'agent'
  /** @deprecated v1 — migrate to `agent` + workerId */
  | 'agent_finance'
  /** @deprecated v1 — migrate to `agent` + workerId */
  | 'agent_coding'
  | 'block'
  | 'gate_and'
  | 'gate_or'
  | 'parallel_start'
  | 'parallel_end'
  | 'or_gate'
  | 'media'
  | 'deploy'
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
  /** schemaVersion 2 after server migrate; missing treated as v1. */
  schemaVersion?: 1 | 2;
  /** Primary pack id (DB column name remains `domain`). */
  domain: string;
  /** API/JSON primary pack id (may mirror `domain` after migrate). */
  primaryDomain?: string;
  domainPackIds?: string[];
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
  /** Design Project id when deploy is project-scoped (Task 10). */
  projectId?: string;
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

/** @deprecated Prefer DomainWorker (v0.4). Alias kept for Harnesses UI. */
export interface AgentHarness {
  id: string;
  name: string;
  domain: string;
  description: string;
  systemPrompt: string;
  allowedTools?: string[];
  isBuiltIn?: boolean;
  constraints?: {
    maxSteps?: number;
    maxTokens?: number;
    timeoutMs?: number;
    maxSpawnedWorkers?: number;
  };
  permissionProfile?: 'read_only' | 'read_write' | 'execute' | 'network' | 'full';
  workspace?:
    | { kind: 'none' }
    | { kind: 'run'; subdir?: string }
    | { kind: 'isolated' };
  defaultMode?: 'solo' | 'coordinator';
  preferredBlockIds?: string[];
  meta?: Record<string, unknown>;
}

/** v0.4 DomainWorker — same shape as AgentHarness (alias). */
export type DomainWorker = AgentHarness;

export type WorkflowSSEEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'node.started'; nodeId: string; nodeType: string }
  | { type: 'node.progress'; nodeId: string; chunk: string; accumulated: string }
  | { type: 'node.completed'; nodeId: string; output: unknown; durationMs?: number }
  | { type: 'node.failed'; nodeId: string; error: string }
  | { type: 'node.warning'; nodeId: string; message: string }
  | { type: 'run.completed'; runId: string; duration: number; artifactId?: string }
  | { type: 'run.failed'; runId: string; error: string }
  | {
      type: 'worker.started';
      nodeId: string;
      workerId: string;
      workerRunId: string;
    }
  | {
      type: 'worker.progress';
      nodeId: string;
      workerRunId: string;
      chunk: string;
    }
  | {
      type: 'worker.completed';
      nodeId: string;
      workerRunId: string;
      output: unknown;
    }
  | {
      type: 'worker.failed';
      nodeId: string;
      workerRunId: string;
      error: string;
    };

export interface WorkflowBlock {
  id: string;
  name: string;
  domain: string;
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
