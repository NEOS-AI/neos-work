/**
 * Tool bridge — converts MCP tools into the core Tool interface.
 */

import { scrubErrorMessage, type Tool, type ToolResult } from '@neos-work/core';

import type { McpClient, McpToolDefinition } from './client.js';

/** Cap MCP tool identity fields (runaway manifest defense). */
export const MCP_TOOL_NAME_MAX_CHARS = 200;
export const MCP_TOOL_DESCRIPTION_MAX_CHARS = 2_000;
/** Cap number of tools registered from a single MCP server. */
export const MCP_TOOLS_MAX = 200;

export function mcpToolToTool(mcpClient: McpClient, mcpTool: McpToolDefinition): Tool {
  let name = '';
  if (typeof mcpTool.name === 'string' && !/[\0\r\n]/.test(mcpTool.name)) {
    const n = mcpTool.name.trim();
    if (n && n.length <= MCP_TOOL_NAME_MAX_CHARS) name = n;
  }
  let description = `MCP tool: ${name || 'unknown'}`;
  if (typeof mcpTool.description === 'string' && !/\0/.test(mcpTool.description)) {
    const d = mcpTool.description.replace(/[\r\n]+/g, ' ').trim();
    if (d) description = d;
  }
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
        if (result.success) {
          return { success: true, output: result.output };
        }
        // MCP isError path: surface scrubbed text as error (output kept for debugging)
        const errText =
          typeof result.output === 'string'
            ? result.output
            : result.output != null
              ? String(result.output)
              : 'MCP tool failed';
        return {
          success: false,
          output: result.output,
          error: scrubErrorMessage(errText, 2_000) || 'MCP tool failed',
        };
      } catch (err) {
        return {
          success: false,
          output: null,
          error:
            scrubErrorMessage(err instanceof Error ? err.message : String(err), 2_000)
            || 'MCP tool failed',
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
