import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { ProviderRegistry, AnthropicAdapter, GoogleAdapter, ToolRegistry, createFilesystemTools } from '@neos-work/core';
import type { ChatParams, Message, MessageContent, ThinkingMode } from '@neos-work/shared';

import * as db from '../db/sessions.js';
import * as settingsDb from '../db/settings.js';

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
  if (!s.title) {
    const title = body.content.slice(0, 60) + (body.content.length > 60 ? '...' : '');
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
  const messages: Message[] = messageRows.map((m) => ({
    role: m.role as Message['role'],
    content: m.metadata && m.metadata !== 'null' ? JSON.parse(m.content) : m.content,
  }));

  const MAX_TOOL_ITERATIONS = 10;

  // Stream response via SSE with tool execution loop
  return streamSSE(c, async (stream) => {
    try {
      let iteration = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (iteration++ >= MAX_TOOL_ITERATIONS) {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ type: 'error', content: 'Max tool iterations reached' }),
          });
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
            await stream.writeSSE({
              event: chunk.type,
              data: JSON.stringify({ ...chunk, toolUseId }),
            });
            continue;
          }

          await stream.writeSSE({
            event: chunk.type,
            data: JSON.stringify(chunk),
          });
        }

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

          // Execute tools and build tool_result message
          const toolResults: MessageContent[] = [];
          for (const call of toolCalls) {
            const result = await toolRegistry.execute(call.toolName, call.toolInput);
            const resultContent = result.success
              ? (typeof result.output === 'string' ? result.output : JSON.stringify(result.output))
              : `Error: ${result.error}`;

            toolResults.push({
              type: 'tool_result',
              toolUseId: call.toolUseId,
              content: resultContent,
            });

            // Send tool_result to client for UI display
            await stream.writeSSE({
              event: 'tool_result',
              data: JSON.stringify({
                type: 'tool_result',
                toolUseId: call.toolUseId,
                toolName: call.toolName,
                toolResult: result.output,
              }),
            });
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
          db.touchSession(sessionId);
        }
        break;
      }
    } catch (error) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          type: 'error',
          content: error instanceof Error ? error.message : 'Stream error',
        }),
      });
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
  if (!body.name) {
    return c.json({ ok: false, error: 'Missing "name"' }, 400);
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
