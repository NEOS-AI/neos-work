/** Presence peer (collab SSE / peers API). */
export interface PresencePeerInfo {
  sessionId: string;
  displayName: string;
  joinedAt?: string;
  colorHint?: number;
  lastSeen?: string;
}

/** Peer editing awareness (v0.7 M2 + v0.8 M3 multi-select). */
export interface PeerSelectionInfo {
  sessionId: string;
  displayName?: string;
  colorHint?: number;
  path: string | null;
  selector: string | null;
  layerId?: string | null;
  /** Full multi-select ordered (last = primary). v0.8 M3 */
  selectors?: string[];
  layerIds?: string[];
  updatedAt?: string;
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
