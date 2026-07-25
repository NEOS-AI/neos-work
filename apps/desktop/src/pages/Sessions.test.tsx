import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listSessions = vi.fn();
const createSession = vi.fn();
const deleteSession = vi.fn();
const listMessages = vi.fn();
const chat = vi.fn();
const runAgent = vi.fn();
const confirmTool = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: {
      listSessions,
      createSession,
      deleteSession,
      listMessages,
      chat,
      runAgent,
      confirmTool,
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data?: unknown[]; itemContent: (i: number, item: unknown) => unknown }) => (
    <div data-testid="virtuoso">
      {(data ?? []).map((item, i) => (
        <div key={i}>{itemContent(i, item) as React.ReactNode}</div>
      ))}
    </div>
  ),
}));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children?: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock('rehype-highlight', () => ({ default: {} }));
vi.mock('rehype-sanitize', () => ({ default: {}, defaultSchema: { attributes: {} } }));
vi.mock('remark-gfm', () => ({ default: {} }));

const { Sessions } = await import('./Sessions.js');

const sessions = [
  {
    id: 's1',
    workspace_id: 'default',
    title: 'Alpha Chat',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    thinking_mode: 'none',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 's2',
    workspace_id: 'default',
    title: null,
    provider: 'google',
    model: 'gemini-2.0-flash',
    thinking_mode: 'none',
    created_at: '2026-01-02T00:00:00.000Z',
    updated_at: '2026-01-15T00:00:00.000Z',
  },
];

describe('Sessions page', () => {
  beforeEach(() => {
    listSessions.mockReset();
    createSession.mockReset();
    deleteSession.mockReset();
    listMessages.mockReset();
    chat.mockReset();
    runAgent.mockReset();
    confirmTool.mockReset();
    listMessages.mockResolvedValue({ ok: true, data: [] });
    confirmTool.mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows empty state when no sessions', async () => {
    listSessions.mockResolvedValue({ ok: true, data: [] });
    render(<Sessions />);
    await waitFor(() => {
      expect(screen.getByText('noTasks')).toBeInTheDocument();
    });
    expect(screen.getByText('emptyState')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'newSession' })).toBeInTheDocument();
  });

  it('lists sessions sorted by updated date and filters by search', async () => {
    const user = userEvent.setup();
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    render(<Sessions />);

    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    expect(screen.getByText('New session')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search…'), 'gemini');
    expect(screen.getByText('New session')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Chat')).not.toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('Search…'));
    await user.type(screen.getByPlaceholderText('Search…'), 'zzzz');
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('Escape clears search and closes new-session modal', async () => {
    const user = userEvent.setup();
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    render(<Sessions />);
    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search…'), 'Alpha');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search…') as HTMLInputElement).value).toBe('');
    });

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'create' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'cancel' })).toBeInTheDocument();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'create' })).not.toBeInTheDocument();
    });
  });

  it('creates a session from modal', async () => {
    listSessions
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValue({ ok: true, data: sessions });
    createSession.mockResolvedValue({ ok: true, data: sessions[0] });
    render(<Sessions />);
    await waitFor(() => expect(screen.getByText('emptyState')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'newSession' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'create' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'create' }));
    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'default',
          provider: 'anthropic',
          thinkingMode: 'none',
        }),
      );
    });
  });

  it('selects a session, loads messages, and deletes it', async () => {
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    listMessages.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'm1',
          session_id: 's1',
          role: 'user',
          content: 'Hello world',
          metadata: null,
          created_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    deleteSession.mockResolvedValue({ ok: true });
    render(<Sessions />);

    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha Chat'));

    await waitFor(() => expect(listMessages).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.getByText('Hello world')).toBeInTheDocument());

    // First delete button is for Alpha Chat (updated most recently / first in sorted list)
    fireEvent.click(screen.getAllByTitle('Delete session')[0]!);
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith('s1'));
  });

  it('sends a chat message and streams assistant text', async () => {
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    // Keep initial history load from racing over the optimistic send
    let resolveMessages: ((value: unknown) => void) | undefined;
    listMessages.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMessages = resolve;
        }),
    );

    chat.mockImplementation(() =>
      (async function* () {
        yield { type: 'text', content: 'Hi there' };
      })(),
    );

    render(<Sessions />);

    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha Chat'));
    await waitFor(() => expect(listMessages).toHaveBeenCalledWith('s1'));

    // Finish history load with empty history before sending
    resolveMessages?.({ ok: true, data: [] });
    await waitFor(() => expect(screen.getByText('startConversation')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'What is up?' } });
    expect(input.value).toBe('What is up?');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(chat).toHaveBeenCalledWith('s1', 'What is up?', expect.any(AbortSignal));
    });
    await waitFor(() => {
      expect(screen.getByText('What is up?')).toBeInTheDocument();
      expect(screen.getByText('Hi there')).toBeInTheDocument();
    });
  });

  it('does not clobber optimistic messages when listMessages resolves late', async () => {
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    let resolveMessages: ((value: unknown) => void) | undefined;
    listMessages.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMessages = resolve;
        }),
    );
    chat.mockImplementation(() =>
      (async function* () {
        yield { type: 'text', content: 'streamed' };
      })(),
    );

    render(<Sessions />);
    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha Chat'));
    await waitFor(() => expect(listMessages).toHaveBeenCalledWith('s1'));

    // Send while history is still loading
    const input = screen.getByPlaceholderText('placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Optimistic hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(chat).toHaveBeenCalled();
      expect(screen.getByText('Optimistic hi')).toBeInTheDocument();
    });

    // Late history must not wipe temp-* messages
    resolveMessages?.({
      ok: true,
      data: [
        {
          id: 'old-1',
          session_id: 's1',
          role: 'user',
          content: 'old history',
          metadata: null,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Optimistic hi')).toBeInTheDocument();
    });
    expect(screen.queryByText('old history')).not.toBeInTheDocument();
  });

  it('does not send blank chat messages and cancels delete when confirm is false', async () => {
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    listMessages.mockResolvedValue({ ok: true, data: [] });
    render(<Sessions />);
    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha Chat'));
    await waitFor(() => expect(screen.getByText('startConversation')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(chat).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getAllByTitle('Delete session')[0]!);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('sends via agent mode when Agent toggle is on', async () => {
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    listMessages.mockResolvedValue({ ok: true, data: [] });
    runAgent.mockImplementation(() =>
      (async function* () {
        yield { type: 'text', content: 'agent reply' };
      })(),
    );

    render(<Sessions />);
    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha Chat'));
    await waitFor(() => expect(screen.getByText('startConversation')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Agent/i }));
    const input = screen.getByPlaceholderText('placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Do the thing' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(runAgent).toHaveBeenCalledWith('s1', 'Do the thing', expect.any(AbortSignal));
      expect(chat).not.toHaveBeenCalled();
    });
  });

  it('shows null-title sessions as New session and loads chat history', async () => {
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    listMessages.mockResolvedValue({ ok: false, error: 'history failed' });
    render(<Sessions />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Chat')).toBeInTheDocument();
    });
    // Second session has title: null → "New session"
    expect(screen.getByText('New session')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Alpha Chat'));
    await waitFor(() => expect(listMessages).toHaveBeenCalledWith('s1'));
  });

  it('surfaces chat stream errors without crashing', async () => {
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    listMessages.mockResolvedValue({ ok: true, data: [] });
    chat.mockImplementation(() =>
      (async function* () {
        yield { type: 'error', content: 'model blew up' };
      })(),
    );

    render(<Sessions />);
    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha Chat'));
    await waitFor(() => expect(screen.getByText('startConversation')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Hi' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(chat).toHaveBeenCalled();
    });
    // Page remains mounted
    expect(screen.getByText('Alpha Chat')).toBeInTheDocument();
  });

  it('aborts an in-flight chat stream via the stop control', async () => {
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    listMessages.mockResolvedValue({ ok: true, data: [] });

    let capturedSignal: AbortSignal | undefined;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    chat.mockImplementation((_id: string, _msg: string, signal: AbortSignal) => {
      capturedSignal = signal;
      return (async function* () {
        yield { type: 'text', content: 'partial…' };
        await gate;
        if (signal.aborted) return;
        yield { type: 'text', content: ' never' };
      })();
    });

    render(<Sessions />);
    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha Chat'));
    await waitFor(() => expect(screen.getByText('startConversation')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'stream me' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('partial…')).toBeInTheDocument());
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // Stop control is the enabled button in the composer (Agent is disabled while streaming)
    const composer = input.closest('div.rounded-xl') as HTMLElement;
    const stopBtn = Array.from(composer.querySelectorAll('button')).find(
      (b) => !(b as HTMLButtonElement).disabled,
    );
    expect(stopBtn).toBeTruthy();
    fireEvent.click(stopBtn!);

    await waitFor(() => expect(capturedSignal!.aborted).toBe(true));
    release?.();
  });

  it('renders thinking chunks, tool steps, and context compression markers', async () => {
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    listMessages.mockResolvedValue({ ok: true, data: [] });
    chat.mockImplementation(() =>
      (async function* () {
        yield { type: 'thinking', content: 'consider options' };
        yield {
          type: 'tool_use',
          toolName: 'read_file',
          toolUseId: 'tu-1',
          toolInput: { path: 'a.ts' },
        };
        yield { type: 'tool_pending', toolUseId: 'tu-1' };
        yield { type: 'tool_result', toolResult: 'file body' };
        yield { type: 'context_compressed' };
        yield { type: 'text', content: 'done' };
      })(),
    );

    render(<Sessions />);
    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha Chat'));
    await waitFor(() => expect(screen.getByText('startConversation')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'analyze' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('done')).toBeInTheDocument();
      expect(screen.getByText('Thought process')).toBeInTheDocument();
      expect(screen.getByText('read_file')).toBeInTheDocument();
      // Divider label + system bubble content both show the same Korean string
      expect(screen.getAllByText('이전 대화 요약됨').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('approves pending tool use via confirmTool', async () => {
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    listMessages.mockResolvedValue({ ok: true, data: [] });

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    chat.mockImplementation(() =>
      (async function* () {
        yield {
          type: 'tool_use',
          toolName: 'shell',
          toolUseId: 'tu-approve',
          toolInput: { cmd: 'ls' },
        };
        yield { type: 'tool_pending', toolUseId: 'tu-approve' };
        await gate;
      })(),
    );

    render(<Sessions />);
    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha Chat'));
    await waitFor(() => expect(screen.getByText('startConversation')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'run shell' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(confirmTool).toHaveBeenCalledWith('s1', 'tu-approve', true);
    });
    release?.();
  });

  it('streams agent plan steps including healing and errors', async () => {
    listSessions.mockResolvedValue({ ok: true, data: sessions });
    listMessages.mockResolvedValue({ ok: true, data: [] });

    const stepA = {
      id: 'step-a',
      description: 'Inspect repo',
      toolName: 'list_directory',
      status: 'pending' as const,
      type: 'plan' as const,
      index: 0,
    };
    const stepB = {
      id: 'step-b',
      description: 'Fix bug',
      toolName: 'write_file',
      status: 'pending' as const,
      type: 'plan' as const,
      index: 1,
    };

    runAgent.mockImplementation(() =>
      (async function* () {
        yield { type: 'plan', steps: [stepA, stepB] };
        yield { type: 'step_start', step: { ...stepA, status: 'running' } };
        yield {
          type: 'step_healing',
          step: stepA,
          strategy: 'retry',
        };
        yield {
          type: 'step_complete',
          step: {
            ...stepA,
            status: 'completed',
            output: { screenshot: 'abc123' },
          },
        };
        yield {
          type: 'step_error',
          step: { ...stepB, status: 'error', error: 'write failed' },
        };
        yield { type: 'text', content: 'agent finished' };
      })(),
    );

    render(<Sessions />);
    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha Chat'));
    await waitFor(() => expect(screen.getByText('startConversation')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Agent/i }));
    const input = screen.getByPlaceholderText('placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'plan it' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Agent Plan')).toBeInTheDocument();
      expect(screen.getByText(/1\/2 steps/)).toBeInTheDocument();
      expect(screen.getByText('Inspect repo')).toBeInTheDocument();
      expect(screen.getByText('write failed')).toBeInTheDocument();
      expect(screen.getByText('agent finished')).toBeInTheDocument();
      expect(screen.getByText('스크린샷 보기 ▼')).toBeInTheDocument();
    });
  });

  it('creates session with selected thinking mode and does not send on Shift+Enter', async () => {
    const user = userEvent.setup();
    listSessions
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValue({ ok: true, data: sessions });
    createSession.mockResolvedValue({ ok: true, data: sessions[0] });
    listMessages.mockResolvedValue({ ok: true, data: [] });

    render(<Sessions />);
    await waitFor(() => expect(screen.getByText('emptyState')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'newSession' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'create' })).toBeInTheDocument());

    // Labels are capitalized THINKING_MODES: Off / Low / Medium / High
    await user.click(screen.getByRole('button', { name: 'High' }));
    fireEvent.click(screen.getByRole('button', { name: 'create' }));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'default',
          thinkingMode: 'high',
        }),
      );
    });

    // Select session and ensure Shift+Enter keeps the draft
    await waitFor(() => expect(screen.getByText('Alpha Chat')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alpha Chat'));
    await waitFor(() => expect(screen.getByText('startConversation')).toBeInTheDocument());

    const input = screen.getByPlaceholderText('placeholder') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'keep me' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(chat).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
    expect(input.value).toBe('keep me');
  });
});
