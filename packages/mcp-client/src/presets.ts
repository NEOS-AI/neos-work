/**
 * Built-in MCP server presets for one-click setup in NEOS Work.
 * TradingView: https://github.com/tradesdontlie/tradingview-mcp
 */

export interface McpPreset {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  transport: 'stdio' | 'http';
  /** For stdio presets: executable (usually "node") */
  command?: string;
  /**
   * Args template. Use `{{installPath}}` for the cloned package root
   * (folder that contains package.json + src/).
   */
  argsTemplate?: string[];
  /** Relative path under installPath that must exist for validation */
  entryRelativePath?: string;
  requirements: string[];
  /** Example tool names exposed by this server (hints for UI / harnesses) */
  toolHints: string[];
  domain?: 'finance' | 'coding' | 'general';
}

/** Cap install path length (path traversal / runaway string defense). */
export const MCP_PRESET_INSTALL_PATH_MAX = 1_024;

export const MCP_PRESETS: readonly McpPreset[] = [
  {
    id: 'tradingview',
    name: 'TradingView',
    description:
      'Connect to your local TradingView Desktop via Chrome DevTools Protocol (port 9222). ' +
      'Read live charts, quotes, indicators, Pine Script, drawings, and screenshots. ' +
      'Requires TradingView Desktop launched with --remote-debugging-port=9222 and a paid plan.',
    docsUrl: 'https://github.com/tradesdontlie/tradingview-mcp',
    transport: 'stdio',
    command: 'node',
    argsTemplate: ['{{installPath}}/src/server.js'],
    entryRelativePath: 'src/server.js',
    requirements: [
      'Node.js 18+',
      'TradingView Desktop app (not browser-only)',
      'Paid TradingView plan for real-time data',
      'Launch TV with --remote-debugging-port=9222',
      'Clone tradesdontlie/tradingview-mcp and run npm install',
    ],
    toolHints: [
      'tv_health_check',
      'tv_launch',
      'quote_get',
      'chart_get_state',
      'symbol_set',
      'timeframe_set',
      'data_get_study_values',
      'screenshot_capture',
      'pine_compile',
      'alert_create',
    ],
    domain: 'finance',
  },
] as const;

export function listMcpPresets(): McpPreset[] {
  return MCP_PRESETS.map((p) => ({ ...p, requirements: [...p.requirements], toolHints: [...p.toolHints] }));
}

export function getMcpPreset(id: string): McpPreset | undefined {
  if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return undefined;
  const trimmed = id.trim().toLowerCase();
  if (!trimmed || trimmed.length > 100) return undefined;
  return MCP_PRESETS.find((p) => p.id === trimmed);
}

/**
 * Sanitize a local install directory path for stdio MCP presets.
 * Rejects control chars, empty, overlong, and obvious traversal sequences.
 */
export function sanitizeMcpInstallPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (/[\0\r\n]/.test(raw)) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MCP_PRESET_INSTALL_PATH_MAX) return null;
  // Reject null-byte already handled; block ".." segments as path escape defense
  const normalized = trimmed.replace(/\\/g, '/');
  const parts = normalized.split('/').filter((p) => p.length > 0);
  if (parts.some((p) => p === '..')) return null;
  return trimmed;
}

/**
 * Expand argsTemplate with installPath. Returns null if template invalid.
 */
export function buildPresetStdioArgs(
  preset: McpPreset,
  installPath: string,
): { command: string; args: string[] } | null {
  const path = sanitizeMcpInstallPath(installPath);
  if (!path) return null;
  if (preset.transport !== 'stdio') return null;
  const command =
    typeof preset.command === 'string' && !/[\0\r\n]/.test(preset.command)
      ? preset.command.trim() || 'node'
      : 'node';
  if (!command || command.length > 500) return null;

  // Normalize path separators for the platform when substituting into args
  const pathForArgs = path.replace(/[/\\]+$/, '');
  const template = Array.isArray(preset.argsTemplate) ? preset.argsTemplate : [];
  const args = template
    .map((a) => {
      if (typeof a !== 'string' || /[\0\r\n]/.test(a)) return '';
      return a.split('{{installPath}}').join(pathForArgs);
    })
    .map((a) => a.trim())
    .filter((a) => a.length > 0 && a.length <= 500)
    .slice(0, 50);

  if (args.length === 0) return null;
  return { command, args };
}
