/**
 * Tool bridge — converts MCP tools into the core Tool interface.
 */

import type { Tool, ToolResult } from '@neos-work/core';

import type { McpClient, McpToolDefinition } from './client.js';

export function mcpToolToTool(mcpClient: McpClient, mcpTool: McpToolDefinition): Tool {
  return {
    name: mcpTool.name,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
    inputSchema: mcpTool.inputSchema,
    async execute(input): Promise<ToolResult> {
      try {
        const result = await mcpClient.callTool(mcpTool.name, input);
        return { success: result.success, output: result.output };
      } catch (err) {
        return { success: false, output: null, error: (err as Error).message };
      }
    },
  };
}

export async function buildMcpTools(mcpClient: McpClient): Promise<Tool[]> {
  const toolDefs = await mcpClient.listTools();
  return toolDefs.map((def) => mcpToolToTool(mcpClient, def));
}
