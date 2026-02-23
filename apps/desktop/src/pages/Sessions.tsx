import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';

import { ALL_MODELS, THINKING_MODES as THINKING_MODE_VALUES } from '@neos-work/shared';

import { useEngine } from '../hooks/useEngine.js';
import type { MessageData, SessionData } from '../lib/engine.js';

interface ToolStep {
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  status: 'running' | 'completed' | 'error';
}

interface DisplayMessage {
  id: string;
  role: string;
  content: string;
  thinking?: string;
  isStreaming?: boolean;
  steps?: ToolStep[];
}

// --- Model definitions (from shared single source of truth) ---

const PROVIDER_NAMES: Record<string, string> = { anthropic: 'Anthropic', google: 'Google' };

const AVAILABLE_MODELS = ALL_MODELS.map((m) => ({
  ...m,
  providerName: PROVIDER_NAMES[m.providerId] ?? m.providerId,
}));

const THINKING_MODES = THINKING_MODE_VALUES.map((v) => ({
  value: v,
  label: v === 'none' ? 'Off' : v.charAt(0).toUpperCase() + v.slice(1),
}));

export function Sessions() {
  const { t } = useTranslation('chat');
  const { client } = useEngine();
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);

  // Load sessions from server
  const loadSessions = useCallback(async () => {
    if (!client) return;
    const res = await client.listSessions();
    if (res.ok) setSessions(res.data ?? []);
  }, [client]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleCreateSession = async (params: {
    provider: string;
    model: string;
    thinkingMode: string;
  }) => {
    if (!client) return;
    const res = await client.createSession({
      workspaceId: 'default',
      provider: params.provider,
      model: params.model,
      thinkingMode: params.thinkingMode,
    });
    if (res.ok && res.data) {
      await loadSessions();
      setActiveSessionId(res.data.id);
    }
    setShowNewSessionModal(false);
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)]">
      {/* Session sidebar */}
      <div className="flex w-56 flex-col border-r" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="flex items-center justify-between p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            {t('tasks')}
          </h3>
          <button
            onClick={() => setShowNewSessionModal(true)}
            className="rounded-md px-2 py-0.5 text-xs transition-colors"
            style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
          >
            +
          </button>
        </div>

        <div className="flex-1 overflow-auto px-2">
          {sessions.length === 0 ? (
            <p className="px-2 py-1 text-xs" style={{ color: 'var(--text-muted)' }}>{t('noTasks')}</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setActiveSessionId(session.id)}
                className="mb-0.5 w-full truncate rounded-lg px-2 py-1.5 text-left text-sm transition-colors"
                style={{
                  backgroundColor: activeSessionId === session.id ? 'var(--bg-tertiary)' : undefined,
                  color: activeSessionId === session.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {session.title || 'New session'}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex flex-1 flex-col">
        {activeSession ? (
          <ChatArea
            key={activeSessionId}
            session={activeSession}
            onSessionUpdate={loadSessions}
          />
        ) : (
          <EmptyState onNewSession={() => setShowNewSessionModal(true)} />
        )}
      </div>

      {/* New session modal */}
      {showNewSessionModal && (
        <NewSessionModal
          onClose={() => setShowNewSessionModal(false)}
          onCreate={handleCreateSession}
        />
      )}
    </div>
  );
}

// --- New Session Modal ---

function NewSessionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (params: { provider: string; model: string; thinkingMode: string }) => void;
}) {
  const { t } = useTranslation('chat');
  const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5-20250929');
  const [thinkingMode, setThinkingMode] = useState('none');

  const selectedModelInfo = AVAILABLE_MODELS.find((m) => m.id === selectedModel);

  const handleCreate = () => {
    onCreate({
      provider: selectedModelInfo?.providerId ?? 'anthropic',
      model: selectedModel,
      thinkingMode,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'var(--overlay-bg)' }}>
      <div className="w-full max-w-sm rounded-xl border p-6 shadow-2xl" style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-secondary)' }}>
        <h2 className="mb-5 text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{t('newSession')}</h2>

        {/* Model selection */}
        <div className="mb-4">
          <label className="mb-2 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            {t('model')}
          </label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
          >
            <optgroup label="Anthropic">
              {AVAILABLE_MODELS.filter((m) => m.providerId === 'anthropic').map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </optgroup>
            <optgroup label="Google">
              {AVAILABLE_MODELS.filter((m) => m.providerId === 'google').map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Thinking mode */}
        <div className="mb-6">
          <label className="mb-2 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            {t('thinkingMode')}
          </label>
          <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)' }}>
            {THINKING_MODES.map((mode) => (
              <button
                key={mode.value}
                onClick={() => setThinkingMode(mode.value)}
                className="flex-1 rounded-md px-2 py-1.5 text-xs transition-colors"
                style={{
                  backgroundColor: thinkingMode === mode.value ? 'var(--border-secondary)' : undefined,
                  color: thinkingMode === mode.value ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm" style={{ color: 'var(--text-secondary)' }}
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleCreate}
            className="rounded-lg px-4 py-2 text-sm transition-colors"
            style={{ backgroundColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
          >
            {t('create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Empty State ---

function EmptyState({ onNewSession }: { onNewSession: () => void }) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('emptyState')}</p>
      <button
        onClick={onNewSession}
        className="rounded-lg px-4 py-2 text-sm transition-colors"
        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
      >
        {t('newSession')}
      </button>
    </div>
  );
}

// --- Chat Area ---

function ChatArea({
  session,
  onSessionUpdate,
}: {
  session: SessionData;
  onSessionUpdate: () => void;
}) {
  const { t } = useTranslation('chat');
  const { client } = useEngine();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load existing messages
  useEffect(() => {
    if (!client) return;
    client.listMessages(session.id).then((res) => {
      if (res.ok && res.data) {
        setMessages(
          (res.data as MessageData[]).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          })),
        );
      }
    });
  }, [client, session.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !client || isStreaming) return;

    const userMessage: DisplayMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: input.trim(),
    };
    const userInput = input.trim();
    setInput('');
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);

    // Add placeholder for assistant response
    const assistantId = `temp-assistant-${Date.now()}`;
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', isStreaming: true }]);

    try {
      abortRef.current = new AbortController();

      for await (const chunk of client.chat(session.id, userInput, abortRef.current.signal)) {
        if (chunk.type === 'text' && chunk.content) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + chunk.content } : m,
            ),
          );
        } else if (chunk.type === 'thinking' && chunk.content) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, thinking: (m.thinking ?? '') + chunk.content }
                : m,
            ),
          );
        } else if (chunk.type === 'tool_use') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    steps: [
                      ...(m.steps ?? []),
                      {
                        toolName: chunk.toolName ?? 'unknown',
                        input: chunk.toolInput ?? {},
                        status: 'running' as const,
                      },
                    ],
                  }
                : m,
            ),
          );
        } else if (chunk.type === 'tool_result') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    steps: m.steps?.map((s, i, arr) =>
                      i === arr.length - 1
                        ? { ...s, output: chunk.toolResult, status: 'completed' as const }
                        : s,
                    ),
                  }
                : m,
            ),
          );
        } else if (chunk.type === 'error') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content || `Error: ${chunk.content}` }
                : m,
            ),
          );
        }
      }

      // Mark streaming as done
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m)),
      );
      onSessionUpdate();
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content || `Error: ${(error as Error).message}`, isStreaming: false }
              : m,
          ),
        );
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Model display name
  const modelInfo = AVAILABLE_MODELS.find((m) => m.id === session.model);
  const modelLabel = modelInfo
    ? `${modelInfo.providerName} · ${modelInfo.name}`
    : `${session.provider} · ${session.model}`;

  return (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl">
          {messages.length === 0 && (
            <p className="py-20 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              {t('startConversation')}
            </p>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`mb-4 ${msg.role === 'user' ? 'text-right' : ''}`}>
              {/* Thinking block (before message bubble) */}
              {msg.thinking && (
                <ThinkingBlock content={msg.thinking} isStreaming={msg.isStreaming} />
              )}

              {/* Tool steps */}
              {msg.steps?.map((step, i) => (
                <ToolStepCard key={i} step={step} />
              ))}

              {/* Message bubble */}
              {(msg.content || msg.role === 'user') && (
                <div
                  className="inline-block max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed"
                  style={{
                    backgroundColor: msg.role === 'user' ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
                    color: msg.role === 'user' ? 'var(--text-primary)' : 'var(--text-primary)',
                  }}
                >
                  {msg.role === 'assistant' ? (
                    <MarkdownContent content={msg.content || '...'} />
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content || '...'}</p>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t p-4" style={{ borderColor: 'var(--border-primary)' }}>
        <div className="mx-auto max-w-2xl">
          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-secondary)' }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('placeholder')}
              rows={1}
              disabled={isStreaming}
              className="w-full resize-none bg-transparent text-sm outline-none disabled:opacity-50"
              style={{ color: 'var(--text-primary)' }}
            />
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span>{modelLabel}</span>
                {session.thinking_mode !== 'none' && (
                  <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                    Thinking: {session.thinking_mode}
                  </span>
                )}
              </div>
              <button
                onClick={isStreaming ? () => abortRef.current?.abort() : handleSend}
                disabled={!isStreaming && !input.trim()}
                className="rounded-lg p-1.5 transition-colors disabled:opacity-30"
                style={{ backgroundColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
              >
                {isStreaming ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12l7-7 7 7" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// --- Markdown Rendering ---

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      className="markdown-content"
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        code: CodeBlock,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function CodeBlock({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) {
  const isBlock = className?.startsWith('hljs') || className?.startsWith('language-');
  const [copied, setCopied] = useState(false);

  if (!isBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  const handleCopy = () => {
    const text = String(children).replace(/\n$/, '');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded-md px-2 py-1 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
        style={{ backgroundColor: 'color-mix(in srgb, var(--bg-tertiary) 80%, transparent)', color: 'var(--text-secondary)' }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <code className={className} {...props}>
        {children}
      </code>
    </div>
  );
}

// --- Thinking Block ---

function ThinkingBlock({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(true);

  // Auto-collapse when streaming ends
  useEffect(() => {
    if (!isStreaming && content) {
      setIsOpen(false);
    }
  }, [isStreaming, content]);

  return (
    <div className="mb-2 max-w-[85%] rounded-lg border" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'color-mix(in srgb, var(--bg-secondary) 50%, transparent)' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs"
        style={{ color: 'var(--text-secondary)' }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="font-medium">
          {isStreaming ? 'Thinking...' : 'Thought process'}
        </span>
        {isStreaming && (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-yellow-400" />
        )}
      </button>
      {isOpen && (
        <div className="border-t px-3 py-2 text-xs leading-relaxed" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}>
          <MarkdownContent content={content} />
        </div>
      )}
    </div>
  );
}

// --- Tool Step Card ---

function ToolStepCard({ step }: { step: ToolStep }) {
  const [isOpen, setIsOpen] = useState(false);

  const statusIcon =
    step.status === 'running' ? (
      <span className="h-2 w-2 animate-spin rounded-full border border-blue-400 border-t-transparent" />
    ) : step.status === 'completed' ? (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    ) : (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    );

  return (
    <div className="mb-2 max-w-[85%] rounded-lg border" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'color-mix(in srgb, var(--bg-secondary) 50%, transparent)' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs"
        style={{ color: 'var(--text-secondary)' }}
      >
        {statusIcon}
        <span className="font-mono">{step.toolName}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div className="border-t px-3 py-2 text-xs" style={{ borderColor: 'var(--border-primary)' }}>
          <div className="mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Input:</div>
          <pre className="mb-2 overflow-x-auto rounded p-2" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
            {JSON.stringify(step.input, null, 2)}
          </pre>
          {step.output !== undefined && (
            <>
              <div className="mb-1 font-medium" style={{ color: 'var(--text-muted)' }}>Output:</div>
              <pre className="overflow-x-auto rounded p-2" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                {typeof step.output === 'string'
                  ? step.output
                  : JSON.stringify(step.output, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
