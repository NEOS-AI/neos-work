import { describe, expect, it } from 'vitest';
import { McpClient, mcpToolToTool, buildMcpTools } from './index.js';

describe('@neos-work/mcp-client barrel exports', () => {
  it('re-exports client and tool-bridge helpers', () => {
    expect(typeof McpClient).toBe('function');
    expect(typeof mcpToolToTool).toBe('function');
    expect(typeof buildMcpTools).toBe('function');
    expect(new McpClient().connected).toBe(false);
  });
});
