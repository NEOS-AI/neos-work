/**
 * MCP servers API — manage MCP server configurations.
 */

import { Hono } from 'hono';

import { getDb } from '../db/schema.js';
import { safeError } from '../lib/errors.js';

const mcp = new Hono();

export interface McpServerRow {
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args: string | null;
  url: string | null;
  enabled: number;
  created_at: string;
}

function listMcpServers(): McpServerRow[] {
  return getDb().prepare('SELECT * FROM mcp_server ORDER BY name ASC').all() as McpServerRow[];
}

function getMcpServer(id: string): McpServerRow | undefined {
  return getDb().prepare('SELECT * FROM mcp_server WHERE id = ?').get(id) as McpServerRow | undefined;
}

function createMcpServer(params: {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
}): McpServerRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const argsStr = params.args ? JSON.stringify(params.args) : null;
  db.prepare(
    `INSERT INTO mcp_server (id, name, transport, command, args, url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, params.name, params.transport, params.command ?? null, argsStr, params.url ?? null);
  return getMcpServer(id)!;
}

function toggleMcpServer(id: string, enabled: boolean): boolean {
  const result = getDb()
    .prepare('UPDATE mcp_server SET enabled = ? WHERE id = ?')
    .run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

function deleteMcpServer(id: string): boolean {
  const result = getDb().prepare('DELETE FROM mcp_server WHERE id = ?').run(id);
  return result.changes > 0;
}

function rowToResponse(row: McpServerRow) {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: row.args ? (JSON.parse(row.args) as string[]) : null,
    url: row.url,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

// GET /api/mcp-servers
mcp.get('/', (c) => {
  const rows = listMcpServers();
  return c.json({ ok: true, data: rows.map(rowToResponse) });
});

// POST /api/mcp-servers
mcp.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      transport: 'stdio' | 'http';
      command?: string;
      args?: string[];
      url?: string;
    }>();

    if (!body.name || typeof body.name !== 'string' || body.name.length > 200) {
      return c.json({ ok: false, error: 'Missing or invalid "name"' }, 400);
    }
    if (!['stdio', 'http'].includes(body.transport)) {
      return c.json({ ok: false, error: 'transport must be "stdio" or "http"' }, 400);
    }
    if (body.transport === 'stdio' && !body.command) {
      return c.json({ ok: false, error: 'command is required for stdio transport' }, 400);
    }
    if (body.transport === 'http' && !body.url) {
      return c.json({ ok: false, error: 'url is required for http transport' }, 400);
    }

    const row = createMcpServer({
      name: body.name,
      transport: body.transport,
      command: body.command,
      args: body.args,
      url: body.url,
    });
    return c.json({ ok: true, data: rowToResponse(row) }, 201);
  } catch (err) {
    return c.json({ ok: false, error: safeError(err, 'mcp-create') }, 500);
  }
});

// POST /api/mcp-servers/:id/toggle
mcp.post('/:id/toggle', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ enabled: boolean }>();
  if (typeof body.enabled !== 'boolean') {
    return c.json({ ok: false, error: 'Missing or invalid "enabled" field' }, 400);
  }
  const updated = toggleMcpServer(id, body.enabled);
  if (!updated) return c.json({ ok: false, error: 'MCP server not found' }, 404);
  return c.json({ ok: true });
});

// DELETE /api/mcp-servers/:id
mcp.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = deleteMcpServer(id);
  if (!deleted) return c.json({ ok: false, error: 'MCP server not found' }, 404);
  return c.json({ ok: true });
});

export { mcp };
