import { describe, expect, it } from 'vitest';
import {
  McpClient,
  mcpToolToTool,
  buildMcpTools,
  listMcpPresets,
  getMcpPreset,
  checkTradingViewCdp,
  normalizeCdpPort,
} from './index.js';

describe('@neos-work/mcp-client barrel exports', () => {
  it('re-exports client, tool-bridge, presets, and TradingView CDP helpers', () => {
    expect(typeof McpClient).toBe('function');
    expect(typeof mcpToolToTool).toBe('function');
    expect(typeof buildMcpTools).toBe('function');
    expect(typeof listMcpPresets).toBe('function');
    expect(typeof getMcpPreset).toBe('function');
    expect(typeof checkTradingViewCdp).toBe('function');
    expect(typeof normalizeCdpPort).toBe('function');
    expect(new McpClient().connected).toBe(false);
    expect(getMcpPreset('tradingview')?.id).toBe('tradingview');
  });
});
