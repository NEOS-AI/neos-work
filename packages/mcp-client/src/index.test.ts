import { describe, expect, it } from 'vitest';
import {
  McpClient,
  mcpToolToTool,
  buildMcpTools,
  listMcpPresets,
  getMcpPreset,
  checkTradingViewCdp,
  normalizeCdpPort,
  listNeosMcpTools,
  createNeosMcpServer,
  buildMcpInstallInfo,
  dispatchNeosMcpTool,
} from './index.js';

describe('@neos-work/mcp-client barrel exports', () => {
  it('re-exports client, tool-bridge, presets, TradingView CDP, and MCP server helpers', () => {
    expect(typeof McpClient).toBe('function');
    expect(typeof mcpToolToTool).toBe('function');
    expect(typeof buildMcpTools).toBe('function');
    expect(typeof listMcpPresets).toBe('function');
    expect(typeof getMcpPreset).toBe('function');
    expect(typeof checkTradingViewCdp).toBe('function');
    expect(typeof normalizeCdpPort).toBe('function');
    expect(typeof listNeosMcpTools).toBe('function');
    expect(typeof createNeosMcpServer).toBe('function');
    expect(typeof buildMcpInstallInfo).toBe('function');
    expect(typeof dispatchNeosMcpTool).toBe('function');
    expect(new McpClient().connected).toBe(false);
    expect(getMcpPreset('tradingview')?.id).toBe('tradingview');
    expect(listNeosMcpTools().length).toBeGreaterThanOrEqual(6);
  });
});
