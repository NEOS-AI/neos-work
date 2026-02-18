/**
 * Base tool interfaces for the agent tool framework.
 */

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
}
