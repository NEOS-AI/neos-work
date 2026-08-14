import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listSessions = vi.fn();
const listWorkspaces = vi.fn();
const createSession = vi.fn();
const deleteSession = vi.fn();
const listSessionMessages = vi.fn();
const streamSessionChat = vi.fn();
const cancelSession = vi.fn();
const createWorkspace = vi.fn();
const deleteWorkspace = vi.fn();

const loadConnection = vi.fn(() => ({
  serverUrl: 'http://127.0.0.1:3000',
  token: 'test-token',
}));

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => loadConnection(),
  clearConnection: vi.fn(),
}));

vi.mock('../lib/api.js', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    WebApiClient: class {
      listSessions = listSessions;
      listWorkspaces = listWorkspaces;
      createSession = createSession;
      deleteSession = deleteSession;
      listSessionMessages = listSessionMessages;
      streamSessionChat = streamSessionChat;
      cancelSession = cancelSession;
      createWorkspace = createWorkspace;
      deleteWorkspace = deleteWorkspace;
    },
  };
});

const { Sessions } = await import('./Sessions.js');

describe('Web Sessions page', () => {
  beforeEach(() => {
    listSessions.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 's1', title: 'Hello', workspace_id: 'default', provider: 'anthropic', model: 'x' }],
    });
    listWorkspaces.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'default', name: 'Default', type: 'local' }],
    });
    createSession.mockReset().mockResolvedValue({
      ok: true,
      data: { id: 's2', title: null },
    });
    deleteSession.mockReset().mockResolvedValue({ ok: true });
    listSessionMessages.mockReset().mockResolvedValue({ ok: true, data: [] });
    streamSessionChat.mockReset().mockReturnValue(() => {});
    loadConnection.mockReturnValue({ serverUrl: 'http://127.0.0.1:3000', token: 'test-token' });
  });

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/sessions']}>
        <Routes>
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/" element={<div data-testid="connect-page">Connect</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('lists sessions and opens chat', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('session-open-s1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('session-open-s1'));
    await waitFor(() => expect(listSessionMessages).toHaveBeenCalledWith('s1'));
    expect(screen.getByTestId('session-input')).toBeInTheDocument();
  });

  it('creates a session', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('session-create')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('session-create'));
    await waitFor(() => expect(createSession).toHaveBeenCalled());
  });

  it('sends chat and can stop', async () => {
    const stop = vi.fn();
    streamSessionChat.mockImplementation((_id, _text, onChunk, opts) => {
      onChunk({ type: 'text', content: 'hi' });
      queueMicrotask(() => opts?.onDone?.());
      return stop;
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('session-open-s1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('session-open-s1'));
    await waitFor(() => expect(screen.getByTestId('session-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('session-input'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByTestId('session-send'));
    await waitFor(() => expect(streamSessionChat).toHaveBeenCalled());
    expect(streamSessionChat.mock.calls[0]![0]).toBe('s1');
    expect(streamSessionChat.mock.calls[0]![1]).toBe('hello');
  });

  it('deletes a session after confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('session-delete-s1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('session-delete-s1'));
    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith('s1'));
  });
});
