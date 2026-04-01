/**
 * MCP client wrapper — connects to a single MCP server via stdio or HTTP SSE.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export class McpClient {
  private client: Client;
  private _connected = false;

  constructor() {
    this.client = new Client({
      name: 'neos-work',
      version: '0.1.2',
    });
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(config: McpServerConfig): Promise<void> {
    if (config.transport === 'stdio') {
      if (!config.command) throw new Error(`MCP server "${config.name}" requires a command for stdio transport`);
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
      });
      await this.client.connect(transport);
    } else if (config.transport === 'http') {
      if (!config.url) throw new Error(`MCP server "${config.name}" requires a URL for HTTP transport`);
      const transport = new SSEClientTransport(new URL(config.url));
      await this.client.connect(transport);
    } else {
      throw new Error(`Unsupported MCP transport: ${(config as McpServerConfig).transport}`);
    }
    this._connected = true;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<{ success: boolean; output: unknown }> {
    const result = await this.client.callTool({ name, arguments: input });

    // Normalize content to string
    const contentArr = result.content as Array<{ type: string; text?: string; data?: unknown }>;
    const output = contentArr
      .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c.data ?? c)))
      .join('\n');

    return { success: !result.isError, output };
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      // Ignore disconnect errors
    }
    this._connected = false;
  }
}
