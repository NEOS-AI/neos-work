/** Presence peer (collab SSE / peers API). */
export interface PresencePeerInfo {
  sessionId: string;
  displayName: string;
  joinedAt?: string;
  colorHint?: number;
}

/** Shared MCP install-info payload (daemon GET /api/mcp/install-info). */
export interface McpInstallInfo {
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
}

export interface CodexMcpStatus {
  available: boolean;
  installed: boolean;
  detail?: string | null;
}
