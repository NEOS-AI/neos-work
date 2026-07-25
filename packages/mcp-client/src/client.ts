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
      version: '0.3.118',
    });
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(config: McpServerConfig): Promise<void> {
    // Control-char check before trim on display name
    let name = 'unknown';
    if (typeof config.name === 'string' && !/[\0\r\n]/.test(config.name)) {
      const n = config.name.trim();
      if (n && n.length <= 200) name = n;
    }
    const transportRaw =
      typeof config.transport === 'string' && !/[\0\r\n]/.test(config.transport)
        ? config.transport.trim().toLowerCase()
        : '';
    const transport = transportRaw === 'http' || transportRaw === 'stdio' ? transportRaw : '';

    if (transport === 'stdio') {
      const commandRaw = typeof config.command === 'string' ? config.command : '';
      if (!commandRaw || /[\0\r\n]/.test(commandRaw)) {
        throw new Error(
          commandRaw
            ? `MCP server "${name}" has an invalid command`
            : `MCP server "${name}" requires a command for stdio transport`,
        );
      }
      const command = commandRaw.trim();
      if (!command) throw new Error(`MCP server "${name}" requires a command for stdio transport`);
      if (command.length > 500) {
        throw new Error(`MCP server "${name}" has an invalid command`);
      }
      const args = Array.isArray(config.args)
        ? config.args
            .map((a) => {
              const s = String(a ?? '');
              if (/[\0\r\n]/.test(s)) return '';
              return s.trim();
            })
            .filter((a) => a.length > 0 && a.length <= 500)
            .slice(0, 50)
        : [];
      const transportImpl = new StdioClientTransport({
        command,
        args,
      });
      await this.client.connect(transportImpl);
    } else if (transport === 'http') {
      const urlRaw = typeof config.url === 'string' ? config.url : '';
      // Control-char check before trim (trim strips leading/trailing \r\n)
      if (/[\0\r\n]/.test(urlRaw)) {
        throw new Error(`MCP server "${name}" has an invalid URL`);
      }
      const url = urlRaw.trim();
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
        let name = '';
        if (typeof t.name === 'string' && !/[\0\r\n]/.test(t.name)) {
          const n = t.name.trim();
          if (n && n.length <= 200) name = n;
        }
        let description: string | undefined;
        if (typeof t.description === 'string' && !/\0/.test(t.description)) {
          description = t.description.replace(/[\r\n]+/g, ' ').trim() || undefined;
          if (description && description.length > 2_000) {
            description = description.slice(0, 2_000);
          }
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
    if (typeof name !== 'string' || /[\0\r\n]/.test(name)) {
      throw new Error('Invalid tool name');
    }
    const toolName = name.trim();
    if (!toolName) throw new Error('Tool name is required');
    if (toolName.length > 200) {
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
