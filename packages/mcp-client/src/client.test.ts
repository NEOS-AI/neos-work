import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const closeMock = vi.fn();
const listToolsMock = vi.fn();
const callToolMock = vi.fn();

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = connectMock;
    close = closeMock;
    listTools = listToolsMock;
    callTool = callToolMock;
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    constructor(public opts: unknown) {}
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {
    constructor(public url: URL) {}
  },
}));

import { McpClient } from './client.js';

describe('McpClient', () => {
  beforeEach(() => {
    connectMock.mockReset().mockResolvedValue(undefined);
    closeMock.mockReset().mockResolvedValue(undefined);
    listToolsMock.mockReset();
    callToolMock.mockReset();
  });

  it('starts disconnected', () => {
    const c = new McpClient();
    expect(c.connected).toBe(false);
  });

  it('rejects stdio without command', async () => {
    const c = new McpClient();
    await expect(
      c.connect({
        id: '1',
        name: 'S',
        transport: 'stdio',
        enabled: true,
      }),
    ).rejects.toThrow(/requires a command/);
    expect(c.connected).toBe(false);
  });

  it('rejects http without url', async () => {
    const c = new McpClient();
    await expect(
      c.connect({
        id: '1',
        name: 'H',
        transport: 'http',
        enabled: true,
      }),
    ).rejects.toThrow(/requires a URL/);
  });

  it('rejects non-http MCP URLs', async () => {
    const c = new McpClient();
    await expect(
      c.connect({
        id: '1',
        name: 'H',
        transport: 'http',
        url: 'file:///etc/passwd',
        enabled: true,
      }),
    ).rejects.toThrow(/http\(s\)/i);
    await expect(
      c.connect({
        id: '1',
        name: 'H',
        transport: 'http',
        url: 'not a url',
        enabled: true,
      }),
    ).rejects.toThrow(/invalid URL/i);
  });

  it('connects via stdio and marks connected', async () => {
    const c = new McpClient();
    await c.connect({
      id: '1',
      name: 'stdio',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'server'],
      enabled: true,
    });
    expect(connectMock).toHaveBeenCalled();
    expect(c.connected).toBe(true);
  });

  it('connects via http', async () => {
    const c = new McpClient();
    await c.connect({
      id: '1',
      name: 'http',
      transport: 'http',
      url: 'https://mcp.example/sse',
      enabled: true,
    });
    expect(connectMock).toHaveBeenCalled();
    expect(c.connected).toBe(true);
  });

  it('listTools maps definitions', async () => {
    listToolsMock.mockResolvedValue({
      tools: [
        { name: 't1', description: 'D', inputSchema: { type: 'object' } },
        { name: 't2', inputSchema: {} },
      ],
    });
    const c = new McpClient();
    const tools = await c.listTools();
    expect(tools).toEqual([
      { name: 't1', description: 'D', inputSchema: { type: 'object' } },
      { name: 't2', description: undefined, inputSchema: {} },
    ]);
  });

  it('listTools trims names and drops blank tool names', async () => {
    listToolsMock.mockResolvedValue({
      tools: [
        { name: '  keep  ', description: '  desc  ', inputSchema: { type: 'object' } },
        { name: '   ', description: 'blank', inputSchema: {} },
        { name: '', inputSchema: {} },
      ],
    });
    const c = new McpClient();
    const tools = await c.listTools();
    expect(tools).toEqual([
      { name: 'keep', description: 'desc', inputSchema: { type: 'object' } },
    ]);
  });

  it('callTool joins text content and respects isError', async () => {
    callToolMock.mockResolvedValue({
      isError: false,
      content: [
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'world' },
      ],
    });
    const c = new McpClient();
    await expect(c.callTool('t', { a: 1 })).resolves.toEqual({
      success: true,
      output: 'hello\nworld',
    });
    expect(callToolMock).toHaveBeenCalledWith({ name: 't', arguments: { a: 1 } });

    callToolMock.mockResolvedValue({
      isError: true,
      content: [{ type: 'data', data: { err: true } }],
    });
    const err = await c.callTool('t', {});
    expect(err.success).toBe(false);
    expect(String(err.output)).toContain('err');
  });

  it('disconnect clears connected even if close throws', async () => {
    closeMock.mockRejectedValueOnce(new Error('already closed'));
    const c = new McpClient();
    await c.connect({
      id: '1',
      name: 's',
      transport: 'stdio',
      command: 'echo',
      enabled: true,
    });
    await c.disconnect();
    expect(c.connected).toBe(false);
  });

  it('rejects unsupported transport', async () => {
    const c = new McpClient();
    await expect(
      c.connect({
        id: '1',
        name: 'weird',
        transport: 'websocket' as 'stdio',
        enabled: true,
      }),
    ).rejects.toThrow(/Unsupported MCP transport/i);
    expect(c.connected).toBe(false);
  });

  it('trims stdio command/args and http url; rejects blank tool name', async () => {
    const c = new McpClient();
    await c.connect({
      id: '1',
      name: '  stdio  ',
      transport: '  STDIO  ' as 'stdio',
      command: '  npx  ',
      args: ['  -y  ', '  ', 'server'],
      enabled: true,
    });
    expect(c.connected).toBe(true);

    await expect(c.callTool('   ', {})).rejects.toThrow(/Tool name is required/i);

    callToolMock.mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'ok' }],
    });
    await c.callTool('  t1  ', { x: 1 });
    expect(callToolMock).toHaveBeenCalledWith({ name: 't1', arguments: { x: 1 } });

    const c2 = new McpClient();
    await c2.connect({
      id: '2',
      name: 'http',
      transport: '  HTTP  ' as 'http',
      url: '  https://mcp.example/sse  ',
      enabled: true,
    });
    expect(c2.connected).toBe(true);
  });

  it('listTools returns empty array when server exposes none', async () => {
    listToolsMock.mockResolvedValue({ tools: [] });
    const c = new McpClient();
    await expect(c.listTools()).resolves.toEqual([]);
  });

  it('listTools tolerates missing tools array', async () => {
    listToolsMock.mockResolvedValue({});
    const c = new McpClient();
    await expect(c.listTools()).resolves.toEqual([]);
  });

  it('callTool joins empty content as empty string', async () => {
    callToolMock.mockResolvedValue({ isError: false, content: [] });
    const c = new McpClient();
    await expect(c.callTool('noop', {})).resolves.toEqual({
      success: true,
      output: '',
    });
  });

  it('callTool tolerates missing or non-array content', async () => {
    callToolMock.mockResolvedValue({ isError: false });
    const c = new McpClient();
    await expect(c.callTool('noop', {})).resolves.toEqual({
      success: true,
      output: '',
    });

    callToolMock.mockResolvedValue({ isError: true, content: 'raw' });
    await expect(c.callTool('noop', {})).resolves.toEqual({
      success: false,
      output: '',
    });
  });
});
