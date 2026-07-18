import { describe, expect, it, vi } from 'vitest';
import type { McpClient, McpToolDefinition } from './client.js';
import { buildMcpTools, mcpToolToTool } from './tool-bridge.js';

function makeClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    connected: true,
    connect: vi.fn(),
    listTools: vi.fn(async () => []),
    callTool: vi.fn(async () => ({ success: true, output: 'ok' })),
    disconnect: vi.fn(),
    ...overrides,
  } as unknown as McpClient;
}

describe('mcpToolToTool', () => {
  const def: McpToolDefinition = {
    name: 'search',
    description: 'Search things',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  };

  it('maps name, description, and schema', () => {
    const tool = mcpToolToTool(makeClient(), def);
    expect(tool.name).toBe('search');
    expect(tool.description).toBe('Search things');
    expect(tool.inputSchema).toEqual(def.inputSchema);
  });

  it('uses fallback description when missing', () => {
    const tool = mcpToolToTool(makeClient(), { ...def, description: undefined });
    expect(tool.description).toBe('MCP tool: search');
  });

  it('execute forwards to callTool and returns success', async () => {
    const callTool = vi.fn(async () => ({ success: true, output: { hits: 2 } }));
    const tool = mcpToolToTool(makeClient({ callTool } as never), def);
    const result = await tool.execute({ q: 'neos' });
    expect(callTool).toHaveBeenCalledWith('search', { q: 'neos' });
    expect(result).toEqual({ success: true, output: { hits: 2 } });
  });

  it('execute maps thrown errors to ToolResult', async () => {
    const callTool = vi.fn(async () => {
      throw new Error('transport closed');
    });
    const tool = mcpToolToTool(makeClient({ callTool } as never), def);
    const result = await tool.execute({});
    expect(result.success).toBe(false);
    expect(result.output).toBeNull();
    expect(result.error).toBe('transport closed');
  });
});

describe('buildMcpTools', () => {
  it('lists tools and wraps each', async () => {
    const listTools = vi.fn(async () => [
      { name: 'a', description: 'A', inputSchema: {} },
      { name: 'b', inputSchema: { type: 'object' } },
    ]);
    const tools = await buildMcpTools(makeClient({ listTools } as never));
    expect(listTools).toHaveBeenCalled();
    expect(tools.map((t) => t.name)).toEqual(['a', 'b']);
    expect(tools[1]!.description).toBe('MCP tool: b');
  });

  it('returns empty array when server exposes no tools', async () => {
    const tools = await buildMcpTools(makeClient());
    expect(tools).toEqual([]);
  });
});
