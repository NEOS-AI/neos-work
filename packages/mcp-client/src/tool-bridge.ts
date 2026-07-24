/**
 * Tool bridge — converts MCP tools into the core Tool interface.
 */

import type { Tool, ToolResult } from '@neos-work/core';

import type { McpClient, McpToolDefinition } from './client.js';

export function mcpToolToTool(mcpClient: McpClient, mcpTool: McpToolDefinition): Tool {
  const name = typeof mcpTool.name === 'string' ? mcpTool.name.trim() : '';
  const description =
    typeof mcpTool.description === 'string'
      ? mcpTool.description.trim() || `MCP tool: ${name}`
      : `MCP tool: ${name}`;
  return {
    name,
    description,
    inputSchema: mcpTool.inputSchema ?? { type: 'object', properties: {} },
    async execute(input): Promise<ToolResult> {
      try {
        const result = await mcpClient.callTool(name, input ?? {});
        return { success: result.success, output: result.output };
      } catch (err) {
        return { success: false, output: null, error: (err as Error).message };
      }
    },
  };
}

export async function buildMcpTools(mcpClient: McpClient): Promise<Tool[]> {
  const toolDefs = await mcpClient.listTools();
  return toolDefs
    .map((def) => mcpToolToTool(mcpClient, def))
    .filter((t) => t.name.length > 0);
}
