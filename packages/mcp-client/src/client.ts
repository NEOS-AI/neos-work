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
      version: '0.3.98',
    });
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(config: McpServerConfig): Promise<void> {
    let name = typeof config.name === 'string' ? config.name.trim() : 'unknown';
    if (!name || /[\0\r\n]/.test(name) || name.length > 200) name = 'unknown';
    const transportRaw =
      typeof config.transport === 'string' ? config.transport.trim().toLowerCase() : '';
    const transport = transportRaw === 'http' || transportRaw === 'stdio' ? transportRaw : '';

    if (transport === 'stdio') {
      const command = typeof config.command === 'string' ? config.command.trim() : '';
      if (!command) throw new Error(`MCP server "${name}" requires a command for stdio transport`);
      if (/[\0\r\n]/.test(command) || command.length > 500) {
        throw new Error(`MCP server "${name}" has an invalid command`);
      }
      const args = Array.isArray(config.args)
        ? config.args
            .map((a) => String(a).trim())
            .filter((a) => a.length > 0 && a.length <= 500 && !/[\0\r\n]/.test(a))
            .slice(0, 50)
        : [];
      const transportImpl = new StdioClientTransport({
        command,
        args,
      });
      await this.client.connect(transportImpl);
    } else if (transport === 'http') {
      const url = typeof config.url === 'string' ? config.url.trim() : '';
      if (!url) throw new Error(`MCP server "${name}" requires a URL for HTTP transport`);
      if (url.length > 2_000) {
        throw new Error(`MCP server "${name}" has an invalid URL`);
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`MCP server "${name}" has an invalid URL`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`MCP server "${name}" URL must be http(s)`);
      }
      const transportImpl = new SSEClientTransport(parsed);
      await this.client.connect(transportImpl);
    } else {
      throw new Error(`Unsupported MCP transport: ${config.transport}`);
    }
    this._connected = true;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.client.listTools();
    const tools = Array.isArray(result.tools) ? result.tools : [];
    return tools
      .slice(0, 200)
      .map((t) => {
        let name = typeof t.name === 'string' ? t.name.trim() : '';
        if (!name || /[\0\r\n]/.test(name) || name.length > 200) name = '';
        let description =
          typeof t.description === 'string' ? t.description.trim() || undefined : t.description;
        if (description && description.length > 2_000) {
          description = description.slice(0, 2_000);
        }
        const inputSchema =
          t.inputSchema && typeof t.inputSchema === 'object' && !Array.isArray(t.inputSchema)
            ? (t.inputSchema as Record<string, unknown>)
            : { type: 'object', properties: {} };
        return { name, description, inputSchema };
      })
      .filter((t) => t.name.length > 0);
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<{ success: boolean; output: unknown }> {
    const toolName = typeof name === 'string' ? name.trim() : '';
    if (!toolName) throw new Error('Tool name is required');
    if (/[\0\r\n]/.test(toolName) || toolName.length > 200) {
      throw new Error('Invalid tool name');
    }
    const args =
      input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const result = await this.client.callTool({ name: toolName, arguments: args });

    // Normalize content to string (tolerate missing / non-array content)
    const contentArr = Array.isArray(result.content)
      ? (result.content as Array<{ type: string; text?: string; data?: unknown }>)
      : [];
    let output = contentArr
      .map((c) => {
        if (!c || typeof c !== 'object') return String(c ?? '');
        return c.type === 'text' ? (c.text ?? '') : JSON.stringify(c.data ?? c);
      })
      .join('\n');
    // Cap tool output so runaway MCP servers cannot bloat agent context
    const OUTPUT_MAX = 512 * 1024;
    if (output.length > OUTPUT_MAX) {
      output = output.slice(0, OUTPUT_MAX) + '\n…[truncated]';
    }

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
