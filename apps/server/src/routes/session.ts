import { resolve } from 'node:path';
import { homedir } from 'node:os';

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { ProviderRegistry, AnthropicAdapter, GoogleAdapter, ToolRegistry, createFilesystemTools } from '@neos-work/core';
import type { ChatParams, Message, MessageContent, ThinkingMode } from '@neos-work/shared';

import * as db from '../db/sessions.js';
import * as settingsDb from '../db/settings.js';

/** Validate that a workspace path is within the user's home directory. */
function validateWorkspacePath(path: string): boolean {
  const resolved = resolve(path);
  const home = homedir();
  return resolved.startsWith(home + '/') || resolved === home;
}

const session = new Hono();

// --- LLM Registry (initialized per-request with provided API keys) ---

function getRegistry(headers: Headers): ProviderRegistry {
  const registry = new ProviderRegistry();

  // Header keys take priority; fall back to DB-stored keys
  const anthropicKey = headers.get('x-anthropic-key') ?? settingsDb.getSetting('apiKey.anthropic');
  if (anthropicKey) {
    registry.register(new AnthropicAdapter(anthropicKey));
  }

  const googleKey = headers.get('x-google-key') ?? settingsDb.getSetting('apiKey.google');
  if (googleKey) {
    registry.register(new GoogleAdapter(googleKey));
  }

  return registry;
}

// --- Session CRUD ---

session.get('/', (c) => {
  const workspaceId = c.req.query('workspaceId');
  const sessions = db.listSessions(workspaceId);
  return c.json({ ok: true, data: sessions });
});

session.post('/', async (c) => {
  const body = await c.req.json<{
    workspaceId: string;
    title?: string;
    provider?: string;
    model?: string;
    thinkingMode?: string;
  }>();
  const created = db.createSession({
    workspaceId: body.workspaceId,
    title: body.title,
    provider: body.provider,
    model: body.model,
    thinkingMode: body.thinkingMode,
  });
  return c.json({ ok: true, data: created }, 201);
});

session.get('/:id', (c) => {
  const s = db.getSession(c.req.param('id'));
  if (!s) return c.json({ ok: false, error: 'Session not found' }, 404);
  return c.json({ ok: true, data: s });
});

session.delete('/:id', (c) => {
  const deleted = db.deleteSession(c.req.param('id'));
  if (!deleted) return c.json({ ok: false, error: 'Session not found' }, 404);
  return c.json({ ok: true });
});

// --- Messages ---

session.get('/:id/messages', (c) => {
  const sessionId = c.req.param('id');
  const s = db.getSession(sessionId);
  if (!s) return c.json({ ok: false, error: 'Session not found' }, 404);
  const messages = db.listMessages(sessionId);
  return c.json({ ok: true, data: messages });
});

// --- Chat (SSE streaming) ---

session.post('/:id/chat', async (c) => {
  const sessionId = c.req.param('id');
  const s = db.getSession(sessionId);
  if (!s) return c.json({ ok: false, error: 'Session not found' }, 404);

  const registry = getRegistry(c.req.raw.headers);
  if (registry.getAll().length === 0) {
    return c.json({ ok: false, error: 'No API key provided. Set x-anthropic-key or x-google-key header.' }, 400);
  }

  const body = await c.req.json<{ content: string }>();

  // Find the adapter for this session's model
  const found = registry.findModel(s.model);
  if (!found) {
    return c.json({ ok: false, error: `No adapter registered for model: ${s.model}` }, 400);
  }

  // Save user message
  db.addMessage({ sessionId, role: 'user', content: body.content });

  // Auto-set title from first message
  const MAX_TITLE_LENGTH = 60;
  if (!s.title) {
    const title = body.content.slice(0, MAX_TITLE_LENGTH) + (body.content.length > MAX_TITLE_LENGTH ? '...' : '');
    db.updateSessionTitle(sessionId, title);
  }

  // Initialize tool registry with workspace-scoped filesystem tools
  const ws = db.getWorkspace(s.workspace_id);
  const workspacePath = ws?.path || process.cwd();
  const toolRegistry = new ToolRegistry();
  for (const tool of createFilesystemTools(workspacePath)) {
    toolRegistry.register(tool);
  }
  const toolDefs = toolRegistry.toDefinitions();

  // Build message history for LLM (supports structured content for tool messages)
  const messageRows = db.listMessages(sessionId);
  const messages: Message[] = messageRows.map((m) => {
    let content: string | MessageContent[];
    if (m.metadata && m.metadata !== 'null') {
      try {
        content = JSON.parse(m.content);
      } catch {
        console.error(`Failed to parse structured message ${m.id}, falling back to text`);
        content = m.content;
      }
    } else {
      content = m.content;
    }
    return { role: m.role as Message['role'], content };
  });

  const MAX_TOOL_ITERATIONS = 10;
  const TOOL_EXEC_TIMEOUT_MS = 30_000;

  // Stream response via SSE with tool execution loop
  return streamSSE(c, async (stream) => {
    let clientDisconnected = false;

    // Detect client disconnection via abort signal
    const abortSignal = c.req.raw.signal;
    abortSignal?.addEventListener('abort', () => {
      clientDisconnected = true;
    });

    /** Safely write to SSE stream; returns false if client disconnected. */
    async function safeSend(event: string, data: string): Promise<boolean> {
      if (clientDisconnected) return false;
      try {
        await stream.writeSSE({ event, data });
        return true;
      } catch {
        clientDisconnected = true;
        return false;
      }
    }

    try {
      let iteration = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (clientDisconnected) break;

        if (iteration++ >= MAX_TOOL_ITERATIONS) {
          await safeSend('error', JSON.stringify({ type: 'error', content: 'Max tool iterations reached' }));
          break;
        }

        const chatParams: ChatParams = {
          model: s.model,
          messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          thinkingMode: (s.thinking_mode as ThinkingMode) ?? 'none',
          maxTokens: 4096,
        };

        let fullText = '';
        const toolCalls: { toolUseId: string; toolName: string; toolInput: Record<string, unknown> }[] = [];

        for await (const chunk of found.provider.chat(chatParams)) {
          if (clientDisconnected) break;

          if (chunk.type === 'text') {
            fullText += chunk.content ?? '';
          } else if (chunk.type === 'tool_use') {
            // Generate ID if adapter didn't provide one (e.g. Google)
            const toolUseId = chunk.toolUseId || `tool_${crypto.randomUUID()}`;
            toolCalls.push({
              toolUseId,
              toolName: chunk.toolName ?? 'unknown',
              toolInput: chunk.toolInput ?? {},
            });
            // Forward chunk with guaranteed ID to client
            await safeSend(chunk.type, JSON.stringify({ ...chunk, toolUseId }));
            continue;
          }

          await safeSend(chunk.type, JSON.stringify(chunk));
        }

        if (clientDisconnected) break;

        if (toolCalls.length > 0) {
          // Build assistant message content (text + tool_use blocks)
          const assistantContent: MessageContent[] = [];
          if (fullText) {
            assistantContent.push({ type: 'text', text: fullText });
          }
          for (const call of toolCalls) {
            assistantContent.push({
              type: 'tool_use',
              id: call.toolUseId,
              name: call.toolName,
              input: call.toolInput,
            });
          }

          // Save assistant message with structured content
          db.addMessage({
            sessionId,
            role: 'assistant',
            content: JSON.stringify(assistantContent),
            metadata: { structured: true },
          });
          messages.push({ role: 'assistant', content: assistantContent });

          // Execute tools with timeout and build tool_result message
          const toolResults: MessageContent[] = [];
          for (const call of toolCalls) {
            if (clientDisconnected) break;

            let result;
            try {
              result = await Promise.race([
                toolRegistry.execute(call.toolName, call.toolInput),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('Tool execution timeout')), TOOL_EXEC_TIMEOUT_MS),
                ),
              ]);
            } catch (err) {
              result = { success: false, output: null, error: (err as Error).message };
            }

            const resultContent = result.success
              ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output))
              : `Error: ${result.error}`;

            toolResults.push({
              type: 'tool_result',
              toolUseId: call.toolUseId,
              content: resultContent,
            });

            // Send tool_result to client for UI display
            await safeSend('tool_result', JSON.stringify({
              type: 'tool_result',
              toolUseId: call.toolUseId,
              toolName: call.toolName,
              toolResult: result.output,
            }));
          }

          // Save tool results as a user message (Anthropic convention)
          db.addMessage({
            sessionId,
            role: 'user',
            content: JSON.stringify(toolResults),
            metadata: { structured: true },
          });
          messages.push({ role: 'user', content: toolResults });

          // Continue loop — LLM will process tool results
          continue;
        }

        // No tool calls — save final text response and exit loop
        if (fullText) {
          db.addMessage({ sessionId, role: 'assistant', content: fullText });
        }
        db.touchSession(sessionId);
        break;
      }
    } catch (error) {
      await safeSend('error', JSON.stringify({
        type: 'error',
        content: error instanceof Error ? error.message : 'Stream error',
      }));
    }
  });
});

export { session };

// --- Separate routes for workspace & models (to avoid /:id collision) ---

const workspace = new Hono();

workspace.get('/', (c) => {
  const workspaces = db.listWorkspaces();
  return c.json({ ok: true, data: workspaces });
});

workspace.post('/', async (c) => {
  const body = await c.req.json<{ name: string; path?: string; type?: string }>();
  if (!body.name || typeof body.name !== 'string' || body.name.length > 200) {
    return c.json({ ok: false, error: 'Missing or invalid "name"' }, 400);
  }
  if (body.path && !validateWorkspacePath(body.path)) {
    return c.json({ ok: false, error: 'Workspace path must be within the home directory' }, 400);
  }
  const created = db.createWorkspace({
    name: body.name,
    path: body.path,
    type: body.type,
  });
  return c.json({ ok: true, data: created }, 201);
});

workspace.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; path?: string }>();
  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 200)) {
    return c.json({ ok: false, error: 'Invalid "name"' }, 400);
  }
  if (body.path && !validateWorkspacePath(body.path)) {
    return c.json({ ok: false, error: 'Workspace path must be within the home directory' }, 400);
  }
  const updated = db.updateWorkspace(id, body);
  if (!updated) return c.json({ ok: false, error: 'Workspace not found' }, 404);
  return c.json({ ok: true, data: updated });
});

workspace.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (id === 'default') {
    return c.json({ ok: false, error: 'Cannot delete default workspace' }, 400);
  }
  const deleted = db.deleteWorkspace(id);
  if (!deleted) return c.json({ ok: false, error: 'Workspace not found' }, 404);
  return c.json({ ok: true });
});

const models = new Hono();

models.get('/', (c) => {
  const registry = getRegistry(c.req.raw.headers);
  const allModels = registry.getAllModels();
  return c.json({ ok: true, data: allModels });
});

export { workspace, models };
