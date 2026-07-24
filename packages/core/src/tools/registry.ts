/**
 * Tool registry — manages available tools and converts to LLM-compatible definitions.
 */

import type { ToolDefinition } from '@neos-work/shared';

import type { Tool, ToolResult } from './base.js';

/** Cap tool identity fields in the registry. */
export const TOOL_NAME_MAX_CHARS = 200;
export const TOOL_DESCRIPTION_MAX_CHARS = 2_000;
/** Cap total registered tools (runaway MCP/plugin registration defense). */
export const TOOL_REGISTRY_MAX = 500;

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    let name = typeof tool?.name === 'string' ? tool.name.trim() : '';
    if (!name || /[\0\r\n]/.test(name) || name.length > TOOL_NAME_MAX_CHARS) return;
    if (this.tools.size >= TOOL_REGISTRY_MAX && !this.tools.has(name)) return;
    let description =
      typeof tool.description === 'string' ? tool.description.trim() : String(tool.description ?? '');
    if (description.length > TOOL_DESCRIPTION_MAX_CHARS) {
      description = description.slice(0, TOOL_DESCRIPTION_MAX_CHARS);
    }
    const inputSchema =
      tool.inputSchema && typeof tool.inputSchema === 'object' && !Array.isArray(tool.inputSchema)
        ? tool.inputSchema
        : { type: 'object', properties: {} };
    this.tools.set(name, { ...tool, name, description, inputSchema });
  }

  get(name: string): Tool | undefined {
    const n = typeof name === 'string' ? name.trim() : '';
    if (!n || /[\0\r\n]/.test(n)) return undefined;
    return this.tools.get(n);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** Convert registered tools to ToolDefinition[] for ChatParams.tools */
  toDefinitions(): ToolDefinition[] {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  /** Execute a tool by name. Returns an error result if the tool is not found. */
  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const n = typeof name === 'string' ? name.trim() : '';
    if (!n) {
      return { success: false, output: null, error: 'Tool name is required' };
    }
    if (/[\0\r\n]/.test(n) || n.length > TOOL_NAME_MAX_CHARS) {
      return { success: false, output: null, error: 'Invalid tool name' };
    }
    const tool = this.tools.get(n);
    if (!tool) {
      return { success: false, output: null, error: `Tool not found: ${n}` };
    }
    try {
      return await tool.execute(input && typeof input === 'object' && !Array.isArray(input) ? input : {});
    } catch (err) {
      return {
        success: false,
        output: null,
        error: err instanceof Error ? err.message : 'Tool execution failed',
      };
    }
  }
}
