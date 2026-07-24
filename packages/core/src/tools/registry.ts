/**
 * Tool registry — manages available tools and converts to LLM-compatible definitions.
 */

import type { ToolDefinition } from '@neos-work/shared';

import type { Tool, ToolResult } from './base.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    const name = typeof tool?.name === 'string' ? tool.name.trim() : '';
    if (!name) return;
    this.tools.set(name, { ...tool, name });
  }

  get(name: string): Tool | undefined {
    const n = typeof name === 'string' ? name.trim() : '';
    if (!n) return undefined;
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
    const tool = this.tools.get(n);
    if (!tool) {
      return { success: false, output: null, error: `Tool not found: ${n}` };
    }
    try {
      return await tool.execute(input ?? {});
    } catch (err) {
      return {
        success: false,
        output: null,
        error: err instanceof Error ? err.message : 'Tool execution failed',
      };
    }
  }
}
