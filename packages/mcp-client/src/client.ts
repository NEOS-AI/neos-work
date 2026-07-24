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
    const name = typeof config.name === 'string' ? config.name.trim() : 'unknown';
    const transportRaw =
      typeof config.transport === 'string' ? config.transport.trim().toLowerCase() : '';
    const transport = transportRaw === 'http' || transportRaw === 'stdio' ? transportRaw : '';

    if (transport === 'stdio') {
      const command = typeof config.command === 'string' ? config.command.trim() : '';
      if (!command) throw new Error(`MCP server "${name}" requires a command for stdio transport`);
      const args = Array.isArray(config.args)
        ? config.args.map((a) => String(a).trim()).filter(Boolean)
        : [];
      const transportImpl = new StdioClientTransport({
        command,
        args,
      });
      await this.client.connect(transportImpl);
    } else if (transport === 'http') {
      const url = typeof config.url === 'string' ? config.url.trim() : '';
      if (!url) throw new Error(`MCP server "${name}" requires a URL for HTTP transport`);
      const transportImpl = new SSEClientTransport(new URL(url));
      await this.client.connect(transportImpl);
    } else {
      throw new Error(`Unsupported MCP transport: ${config.transport}`);
    }
    this._connected = true;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: typeof t.name === 'string' ? t.name.trim() : t.name,
      description:
        typeof t.description === 'string' ? t.description.trim() || undefined : t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<{ success: boolean; output: unknown }> {
    const toolName = typeof name === 'string' ? name.trim() : '';
    if (!toolName) throw new Error('Tool name is required');
    const result = await this.client.callTool({ name: toolName, arguments: input ?? {} });

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
