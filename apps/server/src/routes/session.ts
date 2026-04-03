import { resolve } from 'node:path';
import { homedir } from 'node:os';

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import {
  ProviderRegistry,
  AnthropicAdapter,
  GoogleAdapter,
  ToolRegistry,
  createFilesystemTools,
  createWebSearchTool,
  createShellTool,
  createMemoryTools,
  AgentOrchestrator,
  ContextManager,
} from '@neos-work/core';
import { ALL_MODELS, THINKING_MODES } from '@neos-work/shared';
import type { ChatParams, Message, MessageContent, ThinkingMode } from '@neos-work/shared';

import { McpClient, buildMcpTools } from '@neos-work/mcp-client';
import type { McpServerConfig } from '@neos-work/mcp-client';
import { BrowserManager, createBrowserTools } from '@neos-work/browser-tool';

import * as db from '../db/sessions.js';
import * as agentStepsDb from '../db/agent-steps.js';
import * as memoryDb from '../db/memory.js';
import * as settingsDb from '../db/settings.js';
import { safeError } from '../lib/errors.js';
import { getDb } from '../db/schema.js';

/** Validate that a workspace path is within the user's home directory. */
function validateWorkspacePath(path: string): boolean {
  const resolved = resolve(path);
  const home = homedir();
  return resolved.startsWith(home + '/') || resolved === home;
}

const session = new Hono();

// --- Server-side active chat tracking for cancel support ---

const activeChats = new Map<string, AbortController>();

session.post('/:id/cancel', (c) => {
  const sessionId = c.req.param('id');
  const controller = activeChats.get(sessionId);
  if (!controller) return c.json({ ok: false, error: 'No active chat for session' }, 404);
  controller.abort();
  return c.json({ ok: true });
});

// --- Tool confirmation for destructive operations (VULN-003) ---

const DESTRUCTIVE_TOOLS = new Set(['write_file', 'run_command']);
const TOOL_CONFIRM_TIMEOUT_MS = 60_000;

const pendingConfirmations = new Map<
  string,
  { resolve: (approved: boolean) => void; timer: ReturnType<typeof setTimeout> }
>();

session.post('/:id/tool-confirm/:toolUseId', async (c) => {
  const { toolUseId } = c.req.param();
  const body = await c.req.json<{ approved: boolean }>();
  const pending = pendingConfirmations.get(toolUseId);
  if (!pending) {
    return c.json({ ok: false, error: 'No pending confirmation' }, 404);
  }
  clearTimeout(pending.timer);
  pending.resolve(body.approved);
  pendingConfirmations.delete(toolUseId);
  return c.json({ ok: true });
});

// --- LLM Registry ---

function getRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  const anthropicKey = settingsDb.getSetting('apiKey.anthropic');
  if (anthropicKey) {
    registry.register(new AnthropicAdapter(anthropicKey));
  }

  const googleKey = settingsDb.getSetting('apiKey.google');
  if (googleKey) {
    registry.register(new GoogleAdapter(googleKey));
  }

  return registry;
}

// --- MCP tool loader ---

const mcpClients: McpClient[] = [];

async function loadMcpTools(toolRegistry: ToolRegistry): Promise<void> {
  const rows = getDb()
    .prepare('SELECT * FROM mcp_server WHERE enabled = 1')
    .all() as Array<{ id: string; name: string; transport: string; command: string | null; args: string | null; url: string | null }>;

  for (const row of rows) {
    const config: McpServerConfig = {
      id: row.id,
      name: row.name,
      transport: row.transport as 'stdio' | 'http',
      command: row.command ?? undefined,
      args: row.args ? (JSON.parse(row.args) as string[]) : undefined,
      url: row.url ?? undefined,
      enabled: true,
    };
    const client = new McpClient();
    try {
      await client.connect(config);
      const tools = await buildMcpTools(client);
      for (const tool of tools) {
        toolRegistry.register(tool);
      }
      mcpClients.push(client);
    } catch (err) {
      console.error(`Failed to connect to MCP server "${config.name}":`, err);
    }
  }
}

async function loadBrowserTools(
  toolRegistry: ToolRegistry,
  manager: BrowserManager,
): Promise<void> {
  try {
    await manager.connect();
    for (const tool of createBrowserTools(manager)) {
      toolRegistry.register(tool);
    }
  } catch (err) {
    console.error('Failed to initialize browser tools:', err);
  }
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

  // Input validation
  if (!body.workspaceId || typeof body.workspaceId !== 'string' || body.workspaceId.length > 100) {
    return c.json({ ok: false, error: 'Invalid or missing workspaceId' }, 400);
  }
  if (body.provider && !['anthropic', 'google'].includes(body.provider)) {
    return c.json({ ok: false, error: 'Invalid provider' }, 400);
  }
  if (body.model && !ALL_MODELS.some((m) => m.id === body.model)) {
    return c.json({ ok: false, error: 'Invalid model' }, 400);
  }
  if (body.thinkingMode && !THINKING_MODES.includes(body.thinkingMode as ThinkingMode)) {
    return c.json({ ok: false, error: 'Invalid thinkingMode' }, 400);
  }
  if (body.title && (typeof body.title !== 'string' || body.title.length > 200)) {
    return c.json({ ok: false, error: 'Invalid title' }, 400);
  }

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

  const registry = getRegistry();
  if (registry.getAll().length === 0) {
    return c.json({ ok: false, error: 'No API key configured. Please set API keys in Settings.' }, 400);
  }

  const body = await c.req.json<{ content: string }>();

  // Input validation
  const MAX_CONTENT_LENGTH = 100_000; // 100KB
  if (!body.content || typeof body.content !== 'string') {
    return c.json({ ok: false, error: 'Missing or invalid content' }, 400);
  }
  if (body.content.length > MAX_CONTENT_LENGTH) {
    return c.json({ ok: false, error: `Content exceeds max length (${MAX_CONTENT_LENGTH} characters)` }, 400);
  }

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

  // Initialize tool registry with workspace-scoped tools
  const ws = db.getWorkspace(s.workspace_id);
  const workspacePath = ws?.path || process.cwd();
  const toolRegistry = new ToolRegistry();
  for (const tool of createFilesystemTools(workspacePath)) {
    toolRegistry.register(tool);
  }
  toolRegistry.register(createWebSearchTool());
  toolRegistry.register(createShellTool(workspacePath));
  await loadMcpTools(toolRegistry);
  const toolDefs = toolRegistry.toDefinitions();

  // Build message history for LLM (supports structured content for tool messages)
  const messageRows = db.listMessages(sessionId);
  let messages: Message[] = messageRows.map((m) => {
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
  const contextManager = new ContextManager();

  // Stream response via SSE with tool execution loop
  return streamSSE(c, async (stream) => {
    let clientDisconnected = false;

    // Combine client-disconnect signal with server-side cancel controller
    const serverAbort = new AbortController();
    activeChats.set(sessionId, serverAbort);

    const signals: AbortSignal[] = [serverAbort.signal];
    if (c.req.raw.signal) signals.push(c.req.raw.signal);
    const abortSignal = AbortSignal.any(signals);

    abortSignal.addEventListener('abort', () => {
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

        // 컨텍스트 압축 (토큰 임계값 초과 시)
        if (contextManager.needsCompression(messages)) {
          messages = await contextManager.compress(messages, found.provider, abortSignal);
          await safeSend('context_compressed', JSON.stringify({ type: 'context_compressed' }));
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

            // Request user confirmation for destructive tools (VULN-003)
            if (DESTRUCTIVE_TOOLS.has(call.toolName)) {
              await safeSend('tool_pending', JSON.stringify({
                type: 'tool_pending',
                toolUseId: call.toolUseId,
                toolName: call.toolName,
                toolInput: call.toolInput,
              }));

              const approved = await new Promise<boolean>((resolve) => {
                const timer = setTimeout(() => {
                  pendingConfirmations.delete(call.toolUseId);
                  resolve(false);
                }, TOOL_CONFIRM_TIMEOUT_MS);
                pendingConfirmations.set(call.toolUseId, { resolve, timer });
              });

              if (!approved) {
                const resultContent = 'Error: Tool execution rejected by user';
                toolResults.push({
                  type: 'tool_result',
                  toolUseId: call.toolUseId,
                  content: resultContent,
                });
                await safeSend('tool_result', JSON.stringify({
                  type: 'tool_result',
                  toolUseId: call.toolUseId,
                  toolName: call.toolName,
                  toolResult: null,
                  rejected: true,
                }));
                continue;
              }
            }

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
      const message = safeError(error, 'chat-stream');
      await safeSend('error', JSON.stringify({
        type: 'error',
        content: message,
      }));
    } finally {
      activeChats.delete(sessionId);
    }
  });
});

// --- Agent execution (SSE streaming) ---

session.post('/:id/agent', async (c) => {
  const sessionId = c.req.param('id');
  const s = db.getSession(sessionId);
  if (!s) return c.json({ ok: false, error: 'Session not found' }, 404);

  const registry = getRegistry();
  if (registry.getAll().length === 0) {
    return c.json({ ok: false, error: 'No API key configured. Please set API keys in Settings.' }, 400);
  }

  const body = await c.req.json<{ content: string }>();

  const MAX_CONTENT_LENGTH = 100_000;
  if (!body.content || typeof body.content !== 'string') {
    return c.json({ ok: false, error: 'Missing or invalid content' }, 400);
  }
  if (body.content.length > MAX_CONTENT_LENGTH) {
    return c.json({ ok: false, error: `Content exceeds max length (${MAX_CONTENT_LENGTH} characters)` }, 400);
  }

  const found = registry.findModel(s.model);
  if (!found) {
    return c.json({ ok: false, error: `No adapter registered for model: ${s.model}` }, 400);
  }

  // Save user message and set session title
  db.addMessage({ sessionId, role: 'user', content: body.content });
  const MAX_TITLE_LENGTH = 60;
  if (!s.title) {
    const title = body.content.slice(0, MAX_TITLE_LENGTH) + (body.content.length > MAX_TITLE_LENGTH ? '...' : '');
    db.updateSessionTitle(sessionId, title);
  }

  const ws = db.getWorkspace(s.workspace_id);
  const workspacePath = ws?.path || process.cwd();

  return streamSSE(c, async (stream) => {
    let clientDisconnected = false;

    const serverAbort = new AbortController();
    activeChats.set(sessionId, serverAbort);

    const signals: AbortSignal[] = [serverAbort.signal];
    if (c.req.raw.signal) signals.push(c.req.raw.signal);
    const abortSignal = AbortSignal.any(signals);

    abortSignal.addEventListener('abort', () => {
      clientDisconnected = true;
    });

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

    const browserManager = new BrowserManager();

    try {
      const toolRegistry = new ToolRegistry();
      for (const tool of createFilesystemTools(workspacePath)) {
        toolRegistry.register(tool);
      }
      toolRegistry.register(createWebSearchTool());
      toolRegistry.register(createShellTool(workspacePath));
      await loadMcpTools(toolRegistry);

      // Memory tools with workspace-scoped callbacks
      const workspaceId = s.workspace_id;
      const memoryCallbacks = {
        async save(key: string, content: string, tags?: string[]) {
          memoryDb.createMemory({ workspaceId, key, content, tags });
        },
        async search(query: string, tags?: string[], limit?: number) {
          return memoryDb.searchMemory(workspaceId, query, tags, limit).map((r) => ({
            key: r.key,
            content: r.content,
            tags: r.tags ? (JSON.parse(r.tags) as string[]) : undefined,
          }));
        },
        async remove(key: string) {
          memoryDb.deleteMemory(workspaceId, key);
        },
      };
      for (const tool of createMemoryTools(memoryCallbacks)) {
        toolRegistry.register(tool);
      }

      // Browser tools (session-scoped Chromium instance)
      await loadBrowserTools(toolRegistry, browserManager);

      // Clear previous agent steps for this session
      agentStepsDb.deleteAgentSteps(sessionId);

      // Map internal step IDs → DB row IDs for status updates
      const stepDbIds = new Map<string, string>();

      const orchestrator = new AgentOrchestrator(found.provider, toolRegistry, {
        maxIterations: 10,
        model: s.model,
      });

      let accumulatedText = '';

      for await (const event of orchestrator.run(body.content, abortSignal)) {
        if (clientDisconnected) break;

        switch (event.type) {
          case 'plan': {
            for (const step of event.steps) {
              const row = agentStepsDb.createAgentStep({
                sessionId,
                stepIndex: step.index,
                type: step.type,
                data: step,
              });
              stepDbIds.set(step.id, row.id);
            }
            await safeSend('plan', JSON.stringify({ steps: event.steps }));
            break;
          }
          case 'step_start': {
            const rowId = stepDbIds.get(event.step.id);
            if (rowId) agentStepsDb.updateAgentStep(rowId, { status: 'running', data: event.step });
            await safeSend('step_start', JSON.stringify({ step: event.step }));
            break;
          }
          case 'step_complete': {
            const rowId = stepDbIds.get(event.step.id);
            if (rowId) agentStepsDb.updateAgentStep(rowId, { status: 'completed', data: event.step });
            await safeSend('step_complete', JSON.stringify({ step: event.step }));
            break;
          }
          case 'step_error': {
            const rowId = stepDbIds.get(event.step.id);
            if (rowId) agentStepsDb.updateAgentStep(rowId, { status: 'error', data: event.step, error: event.error });
            await safeSend('step_error', JSON.stringify({ step: event.step, error: event.error }));
            break;
          }
          case 'step_healing': {
            const rowId = stepDbIds.get(event.step.id);
            if (rowId) {
              agentStepsDb.updateAgentStep(rowId, { status: 'running', data: event.step });
            }
            await safeSend('step_healing', JSON.stringify({
              step: event.step,
              strategy: event.strategy,
            }));
            break;
          }
          case 'text': {
            accumulatedText += event.content;
            await safeSend('text', JSON.stringify({ content: event.content }));
            break;
          }
          case 'done': {
            // Save final assistant message
            const finalContent = accumulatedText || 'Agent task completed.';
            db.addMessage({ sessionId, role: 'assistant', content: finalContent });
            db.touchSession(sessionId);
            await safeSend('done', JSON.stringify({ task: event.task }));
            break;
          }
          case 'error': {
            await safeSend('error', JSON.stringify({ error: event.error }));
            break;
          }
        }
      }
    } catch (error) {
      const message = safeError(error, 'agent-stream');
      await safeSend('error', JSON.stringify({ error: message }));
    } finally {
      activeChats.delete(sessionId);
      await browserManager.disconnect();
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
  const registry = getRegistry();
  const allModels = registry.getAllModels();
  return c.json({ ok: true, data: allModels });
});

export { workspace, models };
