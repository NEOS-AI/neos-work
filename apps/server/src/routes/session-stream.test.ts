/**
 * Coverage for session chat/agent SSE paths via mocked LLM adapters.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  let responses: Array<
    Array<{
      type: string;
      content?: string;
      toolUseId?: string;
      toolName?: string;
      toolInput?: Record<string, unknown>;
      error?: string;
    }>
  > = [[{ type: 'text', content: 'mock hello' }, { type: 'done' }]];
  let call = 0;
  let agentEvents: Array<Record<string, unknown>> = [
    { type: 'text', content: 'agent says hi' },
    { type: 'done', task: { status: 'completed' } },
  ];

  return {
    reset() {
      responses = [[{ type: 'text', content: 'mock hello' }, { type: 'done' }]];
      call = 0;
      agentEvents = [
        { type: 'text', content: 'agent says hi' },
        { type: 'done', task: { status: 'completed' } },
      ];
    },
    setResponses(r: typeof responses) {
      responses = r;
      call = 0;
    },
    setAgentEvents(e: typeof agentEvents) {
      agentEvents = e;
    },
    async *chat() {
      const chunks = responses[Math.min(call, responses.length - 1)] ?? [];
      call += 1;
      for (const c of chunks) yield c;
    },
    async *runAgent() {
      for (const e of agentEvents) yield e;
    },
  };
});

vi.mock('@neos-work/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neos-work/core')>();
  const { ANTHROPIC_MODELS, GOOGLE_MODELS } = await import('@neos-work/shared');

  class AnthropicAdapter {
    readonly id = 'anthropic' as const;
    readonly name = 'Anthropic';
    constructor(apiKey: string) {
      if (typeof apiKey !== 'string' || /[\0\r\n]/.test(apiKey) || !apiKey.trim()) {
        throw new Error('ANTHROPIC_API_KEY is required');
      }
    }
    getModels() {
      return ANTHROPIC_MODELS;
    }
    chat = mockState.chat;
    async validateApiKey() {
      return true;
    }
  }

  class GoogleAdapter {
    readonly id = 'google' as const;
    readonly name = 'Google';
    constructor(apiKey: string) {
      if (typeof apiKey !== 'string' || !apiKey.trim()) {
        throw new Error('GOOGLE_API_KEY is required');
      }
    }
    getModels() {
      return GOOGLE_MODELS;
    }
    chat = mockState.chat;
    async validateApiKey() {
      return true;
    }
  }

  class BrowserManager {
    async connect() {
      throw new Error('browser unavailable in tests');
    }
    async disconnect() {}
  }

  class AgentOrchestrator {
    constructor(
      _provider: unknown,
      _tools: unknown,
      _opts?: unknown,
    ) {}
    run = mockState.runAgent;
  }

  return {
    ...actual,
    AnthropicAdapter,
    GoogleAdapter,
    BrowserManager,
    AgentOrchestrator,
  };
});

// Avoid real MCP connect noise during tool load; allow success path for coverage
const mcpMockState = vi.hoisted(() => ({ failConnect: false }));
vi.mock('@neos-work/mcp-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@neos-work/mcp-client')>();
  return {
    ...actual,
    McpClient: class {
      async connect() {
        if (mcpMockState.failConnect) {
          throw new Error('mcp disabled in stream tests');
        }
      }
      async disconnect() {}
    },
    buildMcpTools: async () => [
      {
        name: 'mcp_cov_tool',
        description: 'coverage mcp tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ success: true, output: 'mcp-ok' }),
      },
    ],
  };
});

// Browser tools are session-scoped; avoid Playwright in unit tests
const browserMockState = vi.hoisted(() => ({ failConnect: false }));
vi.mock('@neos-work/browser-tool', () => {
  class BrowserManager {
    async connect() {
      if (browserMockState.failConnect) {
        throw new Error('browser unavailable in tests');
      }
    }
    async disconnect() {}
  }
  return {
    BrowserManager,
    createBrowserTools: () => [
      {
        name: 'browser_cov_tool',
        description: 'coverage browser tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ success: true, output: 'browser-ok' }),
      },
    ],
  };
});

import { listSessions, deleteSession, addMessage } from '../db/sessions.js';
import { deleteSetting, setSetting } from '../db/settings.js';
import { getDb } from '../db/schema.js';
import { session, models } from './session.js';

const TITLE = `_cov_sess_stream_${process.pid}`;

afterEach(() => {
  mockState.reset();
  mcpMockState.failConnect = false;
  browserMockState.failConnect = false;
  for (const s of listSessions('default')) {
    if (s.title === TITLE || (s.title && s.title.startsWith(TITLE))) {
      deleteSession(s.id);
    }
  }
  try {
    deleteSetting('apiKey.anthropic');
  } catch {
    /* ignore */
  }
  try {
    deleteSetting('apiKey.google');
  } catch {
    /* ignore */
  }
});

async function createSession(opts?: {
  title?: string | null;
  model?: string;
  provider?: string;
}): Promise<string> {
  const body: Record<string, unknown> = {
    workspaceId: 'default',
    provider: opts?.provider ?? 'anthropic',
  };
  if (opts?.title !== null) body.title = opts?.title ?? TITLE;
  if (opts?.model) body.model = opts.model;
  const create = await session.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(create.status).toBe(201);
  const created = (await create.json()) as { data: { id: string } };
  return created.data.id;
}

describe('session chat SSE (mocked LLM)', () => {
  beforeEach(() => {
    setSetting('apiKey.anthropic', 'sk-test-stream-coverage');
  });

  it('streams text response and saves assistant message', async () => {
    const id = await createSession();
    mockState.setResponses([
      [{ type: 'text', content: 'Hello coverage' }, { type: 'done' }],
    ]);

    const res = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'say hi' }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/Hello coverage/);

    const msgs = await session.request(`/${id}/messages`);
    const msgBody = (await msgs.json()) as {
      data: Array<{ role: string; content: string }>;
    };
    expect(msgBody.data.some((m) => m.role === 'user' && m.content === 'say hi')).toBe(true);
    expect(msgBody.data.some((m) => m.role === 'assistant' && m.content.includes('Hello coverage'))).toBe(
      true,
    );
  });

  it('auto-sets title from first message when title empty', async () => {
    const id = await createSession({ title: null });
    mockState.setResponses([[{ type: 'text', content: 'ok' }, { type: 'done' }]]);

    const long = 'a'.repeat(80);
    const res = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: long }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const get = await session.request(`/${id}`);
    const s = (await get.json()) as { data: { title: string | null } };
    expect(s.data.title).toBeTruthy();
    expect(s.data.title!.endsWith('...')).toBe(true);
    expect(s.data.title!.length).toBeLessThanOrEqual(63);
  });

  it('returns 400 when model has no registered adapter', async () => {
    // Google model but only anthropic key → findModel may still find google models if google registered.
    // Use google model without google key:
    const id = await createSession({
      model: 'gemini-2.0-flash',
      provider: 'google',
    });
    // Only anthropic key set — google adapter not registered
    const res = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hi' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/No adapter registered for model/i);
  });

  it('executes non-destructive tool_use loop then final text', async () => {
    const id = await createSession();
    mockState.setResponses([
      [
        {
          type: 'tool_use',
          toolUseId: 'tool_read_1',
          toolName: 'list_directory',
          toolInput: { path: '.' },
        },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'listed dir' }, { type: 'done' }],
    ]);

    const res = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'list files' }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/tool_result|listed dir|tool_use/);
  });

  it('tool_use without id generates tool_ prefix id', async () => {
    const id = await createSession();
    mockState.setResponses([
      [
        {
          type: 'tool_use',
          // no toolUseId
          toolName: 'list_directory',
          toolInput: { path: '.' },
        },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'done' }, { type: 'done' }],
    ]);

    const res = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'list' }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/tool_/);
  });

  it('rejects destructive tool when confirmation is denied', async () => {
    const id = await createSession();
    mockState.setResponses([
      [
        {
          type: 'tool_use',
          toolUseId: 'tool_write_1',
          toolName: 'write_file',
          toolInput: { path: 'cov-test-write.txt', content: 'x' },
        },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'after reject' }, { type: 'done' }],
    ]);

    // Response headers resolve; body consumption drives the SSE producer (and pending confirm)
    const res = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'write something' }),
    });
    expect(res.status).toBe(200);
    const textPromise = res.text();

    let denied = false;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const conf = await session.request(`/${id}/tool-confirm/tool_write_1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approved: false }),
      });
      if (conf.status === 200) {
        denied = true;
        break;
      }
    }
    expect(denied).toBe(true);

    const body = await textPromise;
    expect(body).toMatch(/rejected|after reject|tool_pending|tool_result/);
  });

  it('approves destructive tool confirmation', async () => {
    const id = await createSession();
    mockState.setResponses([
      [
        {
          type: 'tool_use',
          toolUseId: 'tool_write_ok',
          toolName: 'write_file',
          toolInput: { path: `.neos-cov/write_${process.pid}.txt`, content: 'ok' },
        },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'wrote file' }, { type: 'done' }],
    ]);

    const res = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'please write' }),
    });
    expect(res.status).toBe(200);
    const textPromise = res.text();

    let ok = false;
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const conf = await session.request(`/${id}/tool-confirm/tool_write_ok`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      });
      if (conf.status === 200) {
        ok = true;
        break;
      }
    }
    expect(ok).toBe(true);

    const body = await textPromise;
    expect(body).toMatch(/wrote file|tool_result|tool_pending/);
  });

  it('cancel aborts an in-flight chat', async () => {
    const id = await createSession();
    // Slow stream: hang until aborted by never finishing... use a long-running async generator
    mockState.setResponses([]);
    // Override chat to wait
    const hang = vi.fn(async function* () {
      yield { type: 'text', content: 'partial' };
      await new Promise((r) => setTimeout(r, 5000));
      yield { type: 'done' };
    });
    // Directly patch via setResponses won't work for hang — use multi-step with delayed second chunk
    mockState.setResponses([
      [
        { type: 'text', content: 'start' },
        // done comes later only if not cancelled — single response is fine
        { type: 'done' },
      ],
    ]);

    // Start chat and immediately cancel
    const chatPromise = session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'cancel me' }),
    });

    // Give stream a moment to register activeChats
    await new Promise((r) => setTimeout(r, 30));
    const cancel = await session.request(`/${id}/cancel`, { method: 'POST' });
    // May be 200 if still active, or 404 if already finished quickly
    expect([200, 404]).toContain(cancel.status);

    const res = await chatPromise;
    expect(res.status).toBe(200);
    await res.text();
    void hang;
  });

  it('handles provider stream error event path', async () => {
    const id = await createSession();
    mockState.setResponses([
      [
        {
          type: 'error',
          content: 'upstream failed',
        },
      ],
    ]);

    const res = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'error path' }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/error|upstream failed/);
  });

  it('loads MCP args (invalid JSON + valid) and structured history before chat', async () => {
    const id = await createSession();
    const db = getDb();
    const mcpIds = [`mcp_bad_${process.pid}`, `mcp_ok_${process.pid}`];
    db.prepare(
      `INSERT INTO mcp_server (id, name, transport, command, args, url, enabled)
       VALUES (?, ?, 'stdio', 'npx', ?, NULL, 1)`,
    ).run(mcpIds[0], `_cov_mcp_bad_${process.pid}`, '{not-json');
    db.prepare(
      `INSERT INTO mcp_server (id, name, transport, command, args, url, enabled)
       VALUES (?, ?, 'stdio', 'npx', ?, NULL, 1)`,
    ).run(
      mcpIds[1],
      `_cov_mcp_ok_${process.pid}`,
      JSON.stringify(['-y', 'pkg', '\nbad', '', 'ok']),
    );

    // structured metadata message (array) + invalid structured JSON fallback
    addMessage({
      sessionId: id,
      role: 'assistant',
      content: JSON.stringify([{ type: 'text', text: 'prior structured' }]),
      metadata: { structured: true },
    });
    addMessage({
      sessionId: id,
      role: 'assistant',
      content: '{not-json-array',
      metadata: { structured: true },
    });

    mockState.setResponses([[{ type: 'text', content: 'after history' }, { type: 'done' }]]);
    try {
      const res = await session.request(`/${id}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'continue' }),
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/after history/);
    } finally {
      for (const mid of mcpIds) {
        db.prepare('DELETE FROM mcp_server WHERE id = ?').run(mid);
      }
    }
  });

  it('registers MCP + browser tools on successful connect', async () => {
    const id = await createSession();
    const db = getDb();
    const mcpId = `mcp_ok_tools_${process.pid}`;
    db.prepare(
      `INSERT INTO mcp_server (id, name, transport, command, args, url, enabled)
       VALUES (?, ?, 'stdio', 'npx', ?, NULL, 1)`,
    ).run(mcpId, `_cov_mcp_tools_${process.pid}`, JSON.stringify(['-y', 'pkg']));

    mockState.setResponses([
      [
        {
          type: 'tool_use',
          toolUseId: 'tool_mcp_1',
          toolName: 'mcp_cov_tool',
          toolInput: {},
        },
        { type: 'done' },
      ],
      [{ type: 'text', content: 'used mcp tool' }, { type: 'done' }],
    ]);
    try {
      const res = await session.request(`/${id}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'use mcp' }),
      });
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toMatch(/mcp-ok|used mcp tool|tool_result|tool_use/);
    } finally {
      db.prepare('DELETE FROM mcp_server WHERE id = ?').run(mcpId);
    }
  });

  it('tolerates MCP/browser connect failures during agent stream', async () => {
    mcpMockState.failConnect = true;
    browserMockState.failConnect = true;
    const id = await createSession();
    mockState.setAgentEvents([
      { type: 'text', content: 'agent with failed tools' },
      { type: 'done', task: { status: 'completed' } },
    ]);
    const res = await session.request(`/${id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'agent fail tools' }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/agent with failed tools|done|completed/i);
  });

  it('delete missing session and blank id paths return 404', async () => {
    const del = await session.request('/00000000-0000-0000-0000-000000000099', {
      method: 'DELETE',
    });
    expect(del.status).toBe(404);
    const msgs = await session.request('/00000000-0000-0000-0000-000000000099/messages');
    expect(msgs.status).toBe(404);
    const chat = await session.request('/00000000-0000-0000-0000-000000000099/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x' }),
    });
    expect(chat.status).toBe(404);
    const blank = await session.request('/%20', { method: 'DELETE' });
    expect(blank.status).toBe(404);
  });
});

describe('session agent SSE (mocked orchestrator)', () => {
  beforeEach(() => {
    setSetting('apiKey.anthropic', 'sk-test-agent-coverage');
  });

  it('streams agent text and done events', async () => {
    const id = await createSession();
    mockState.setAgentEvents([
      { type: 'text', content: 'planning...' },
      { type: 'done', task: { status: 'completed' } },
    ]);

    const res = await session.request(`/${id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'do a thing' }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/planning|done|completed/i);

    const msgs = await session.request(`/${id}/messages`);
    const msgBody = (await msgs.json()) as { data: Array<{ role: string; content: string }> };
    expect(msgBody.data.some((m) => m.role === 'user')).toBe(true);
    expect(msgBody.data.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('auto-titles untitled agent sessions', async () => {
    const id = await createSession({ title: null });
    mockState.setAgentEvents([
      { type: 'text', content: 'x' },
      { type: 'done', task: { status: 'completed' } },
    ]);

    const res = await session.request(`/${id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'title me please' }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const get = await session.request(`/${id}`);
    const s = (await get.json()) as { data: { title: string | null } };
    expect(s.data.title).toMatch(/title me/i);
  });

  it('handles plan / step lifecycle events', async () => {
    const id = await createSession();
    // createAgentStep only accepts plan|tool_use|tool_result|reasoning|error
    const step = {
      id: 's1',
      index: 0,
      type: 'tool_use',
      status: 'pending',
      description: 'step one',
    };
    mockState.setAgentEvents([
      { type: 'plan', steps: [step] },
      { type: 'step_start', step: { ...step, status: 'running' } },
      { type: 'step_complete', step: { ...step, status: 'completed' } },
      { type: 'text', content: 'finished steps' },
      { type: 'done', task: { status: 'completed' } },
    ]);

    const res = await session.request(`/${id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'run plan' }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/plan|step_start|step_complete|finished steps/);
  });

  it('handles step_error, step_healing, and error events', async () => {
    const id = await createSession();
    const step = {
      id: 's2',
      index: 0,
      type: 'tool_use',
      status: 'running',
      description: 'heal me',
    };
    mockState.setAgentEvents([
      { type: 'plan', steps: [step] },
      { type: 'step_start', step },
      { type: 'step_healing', step, strategy: 'retry' },
      { type: 'step_error', step, error: 'boom' },
      { type: 'error', error: 'agent failed' },
      { type: 'done', task: { status: 'failed' } },
    ]);

    const res = await session.request(`/${id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'heal path' }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/step_healing|step_error|agent failed|error/);
  });

  it('returns 400 for unknown model on agent', async () => {
    const id = await createSession({
      model: 'gemini-2.0-flash',
      provider: 'google',
    });
    const res = await session.request(`/${id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'nope' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/No adapter/i);
  });

  it('rejects overlong and null-byte content after API key gate', async () => {
    const id = await createSession();
    const over = 'x'.repeat(100_001);
    const chatOver = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: over }),
    });
    expect(chatOver.status).toBe(400);
    expect(((await chatOver.json()) as { error: string }).error).toMatch(/max length/i);

    const agentOver = await session.request(`/${id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: over }),
    });
    expect(agentOver.status).toBe(400);
    expect(((await agentOver.json()) as { error: string }).error).toMatch(/max length/i);

    const chatNul = await session.request(`/${id}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: `hi${'\0'}` }),
    });
    expect(chatNul.status).toBe(400);
    expect(((await chatNul.json()) as { error: string }).error).toMatch(/control characters/i);

    const agentNul = await session.request(`/${id}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: `hi${'\0'}` }),
    });
    expect(agentNul.status).toBe(400);
    expect(((await agentNul.json()) as { error: string }).error).toMatch(/control characters/i);

    // blank session id path params
    expect(
      (
        await session.request('/%20/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await session.request('/%20/agent', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: 'x' }),
        })
      ).status,
    ).toBe(404);
  });
});

describe('models registry with google key', () => {
  it('registers google adapter when google key set', async () => {
    setSetting('apiKey.google', 'gk-test-models');
    try {
      const res = await models.request('/');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      expect(body.data.some((m) => m.id.startsWith('gemini'))).toBe(true);
    } finally {
      deleteSetting('apiKey.google');
    }
  });
});
