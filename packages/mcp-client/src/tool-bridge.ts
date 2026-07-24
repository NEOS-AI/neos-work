/**
 * Tool bridge — converts MCP tools into the core Tool interface.
 */

import type { Tool, ToolResult } from '@neos-work/core';

import type { McpClient, McpToolDefinition } from './client.js';

/** Cap MCP tool identity fields (runaway manifest defense). */
export const MCP_TOOL_NAME_MAX_CHARS = 200;
export const MCP_TOOL_DESCRIPTION_MAX_CHARS = 2_000;
/** Cap number of tools registered from a single MCP server. */
export const MCP_TOOLS_MAX = 200;

export function mcpToolToTool(mcpClient: McpClient, mcpTool: McpToolDefinition): Tool {
  let name = typeof mcpTool.name === 'string' ? mcpTool.name.trim() : '';
  // Drop control chars / overlong names (unusable in registry keys)
  if (!name || /[\0\r\n]/.test(name) || name.length > MCP_TOOL_NAME_MAX_CHARS) {
    name = '';
  }
  let description =
    typeof mcpTool.description === 'string'
      ? mcpTool.description.trim() || `MCP tool: ${name}`
      : `MCP tool: ${name}`;
  if (description.length > MCP_TOOL_DESCRIPTION_MAX_CHARS) {
    description = description.slice(0, MCP_TOOL_DESCRIPTION_MAX_CHARS);
  }
  const inputSchema =
    mcpTool.inputSchema && typeof mcpTool.inputSchema === 'object' && !Array.isArray(mcpTool.inputSchema)
      ? mcpTool.inputSchema
      : { type: 'object', properties: {} };
  return {
    name,
    description,
    inputSchema,
    async execute(input): Promise<ToolResult> {
      try {
        const result = await mcpClient.callTool(name, input ?? {});
        return { success: result.success, output: result.output };
      } catch (err) {
        return {
          success: false,
          output: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export async function buildMcpTools(mcpClient: McpClient): Promise<Tool[]> {
  const toolDefs = await mcpClient.listTools();
  return toolDefs
    .slice(0, MCP_TOOLS_MAX)
    .map((def) => mcpToolToTool(mcpClient, def))
    .filter((t) => t.name.length > 0);
}
