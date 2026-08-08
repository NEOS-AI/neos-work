/**
 * Settings / connection-test / MCP API surface on the desktop engine client.
 * v0.16 Track A: extracted from engine.ts (EngineClient extends this).
 */

import type { ApiResponse } from '@neos-work/shared';
import { EngineWorkflowClient } from './engine-workflow.js';
import { readApiResponse } from './engine-transport.js';

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

export class EngineSettingsClient extends EngineWorkflowClient {
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
}
