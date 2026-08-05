import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const writeFile = vi.fn(async () => ({ ok: true, data: { hash: 'h1' } }));
const createRun = vi.fn(async () => ({ ok: true, data: { id: 'run1', status: 'queued' } }));
const getRun = vi.fn(async () => ({ ok: true, data: { id: 'run1', status: 'succeeded' } }));
const listRuns = vi.fn(async () => ({
  ok: true,
  data: [
    {
      id: 'run-abc',
      status: 'running',
      projectId: 'p1',
      prompt: 'Make the hero blue',
      createdAt: '2026-01-02T00:00:00.000Z',
      eventCount: 2,
    },
  ],
}));
const listRunEvents = vi.fn(async () => ({
  ok: true,
  data: [
    {
      id: 'ev1',
      type: 'run.started',
      ts: '2026-01-02T00:00:01.000Z',
    },
    {
      id: 'ev2',
      type: 'run.stdout',
      ts: '2026-01-02T00:00:02.000Z',
      data: { chunk: 'hello from agent' },
    },
  ],
}));
const cancelRun = vi.fn(async () => ({
  ok: true,
  data: { id: 'run-abc', status: 'canceled' },
}));
const readFile = vi.fn(async (_pid: string, path: string) => ({
  ok: true,
  data: {
    path,
    content: path === 'index.html' ? '<html><body><h1 id="hero">Hi</h1></body></html>' : 'body{}',
    hash: 'abc',
  },
}));
const listRevisions = vi.fn(async () => ({
  ok: true,
  data: [
    {
      id: 'rev1',
      projectId: 'p1',
      path: 'index.html',
      contentHash: 'deadbeef01',
      source: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
}));
const getRevision = vi.fn(async () => ({
  ok: true,
  data: {
    id: 'rev1',
    projectId: 'p1',
    path: 'index.html',
    contentHash: 'deadbeef01',
    source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    content: '<html><body>old</body></html>',
  },
}));
const restoreRevision = vi.fn(async () => ({
  ok: true,
  data: { path: 'index.html', hash: 'restored-h' },
}));

type SseHandler = (ev: {
  type: string;
  path?: string;
  hash?: string;
}) => void;
let sseHandler: SseHandler | null = null;
const streamProjectFileEvents = vi.fn((_id: string, cb: SseHandler) => {
  sseHandler = cb;
  return () => {
    sseHandler = null;
  };
});

type RunSseHandler = (ev: {
  type: string;
  id?: string;
  ts?: string;
  data?: unknown;
}) => void;
const streamRunEvents = vi.fn(
  (
    _runId: string,
    onEvent: RunSseHandler,
    opts?: { onDone?: () => void; onError?: (err: unknown) => void },
  ) => {
    // Default: emit a quick terminal-friendly stream then complete
    queueMicrotask(() => {
      onEvent({
        type: 'run.started',
        id: 'ev-start',
        ts: '2026-01-01T00:00:00.000Z',
      });
      onEvent({
        type: 'run.succeeded',
        id: 'ev-end',
        ts: '2026-01-01T00:00:01.000Z',
      });
      opts?.onDone?.();
    });
    return () => {};
  },
);

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({
    serverUrl: 'http://127.0.0.1:3000',
    token: 'test-token',
  }),
}));

vi.mock('../lib/api.js', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  function normalizeProjectRelPath(raw: unknown): string {
    if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
    const p = raw.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!p || p.length > 500) return '';
    if (p.includes('..')) return '';
    if (p.startsWith('~/') || /^[A-Za-z]:\//.test(p)) return '';
    return p;
  }
  return {
    ApiError,
    normalizeProjectRelPath,
    WebApiClient: class {
      getProject = vi.fn(async () => ({
        ok: true,
        data: { id: 'p1', name: 'Demo', entryFile: 'index.html' },
      }));
      listFiles = vi.fn(async () => ({
        ok: true,
        data: [
          { path: 'index.html', type: 'file' },
          { path: 'style.css', type: 'file' },
        ],
      }));
      readFile = readFile;
      writeFile = writeFile;
      createRun = createRun;
      getRun = getRun;
      listRuns = listRuns;
      listRunEvents = listRunEvents;
      cancelRun = cancelRun;
      listRevisions = listRevisions;
      getRevision = getRevision;
      restoreRevision = restoreRevision;
      streamProjectFileEvents = streamProjectFileEvents;
      streamRunEvents = streamRunEvents;
      streamProjectCollab = () => () => {};
      collabLock = vi.fn(async () => ({ ok: true, data: {} }));
      collabSelection = vi.fn(async () => ({ ok: true, data: {} }));
      getCollabPeers = vi.fn(async () => ({ ok: true, data: { peers: [] } }));
      getCollabLocks = vi.fn(async () => ({ ok: true, data: { locks: [] } }));
      getCollabSelections = vi.fn(async () => ({ ok: true, data: { selections: [] } }));
      postCollabHeartbeat = vi.fn(async () => ({ ok: true, data: { touched: true } }));
    },
  };
});

vi.mock('@neos-work/design-editor', async () => {
  const actual = await vi.importActual<typeof import('@neos-work/design-editor')>(
    '@neos-work/design-editor',
  );
  return {
    ...actual,
    DesignEditor: (props: {
      buffer: { path: string | null; local: string; pendingDisk?: string | null };
      onEdit?: (c: string) => void;
      onSave?: () => void;
      saving?: boolean;
      onResolveConflict?: (choice: 'keep-mine' | 'take-agent' | 'diff') => void;
    }) => (
      <div data-testid="design-editor">
        <div data-testid="editor-path">{props.buffer.path}</div>
        {props.buffer.pendingDisk != null && (
          <div data-testid="conflict-banner">
            <button
              type="button"
              data-testid="conflict-take"
              onClick={() => props.onResolveConflict?.('take-agent')}
            >
              Take agent
            </button>
          </div>
        )}
        <textarea
          data-testid="file-editor"
          value={props.buffer.local}
          onChange={(e) => props.onEdit?.(e.target.value)}
        />
        <button type="button" data-testid="file-save" onClick={() => props.onSave?.()}>
          {props.saving ? '…' : 'Save'}
        </button>
      </div>
    ),
  };
});

const { ProjectDetail } = await import('./ProjectDetail.js');

function renderProject() {
  return render(
    <MemoryRouter initialEntries={['/projects/p1']}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProjectDetail Design Editor', () => {
  beforeEach(() => {
    writeFile.mockClear();
    createRun.mockClear();
    getRun.mockClear();
    listRuns.mockClear();
    listRunEvents.mockClear();
    cancelRun.mockClear();
    streamRunEvents.mockClear().mockImplementation(
      (
        _runId: string,
        onEvent: RunSseHandler,
        opts?: { onDone?: () => void; onError?: (err: unknown) => void },
      ) => {
        queueMicrotask(() => {
          onEvent({ type: 'run.started', id: 'ev-start' });
          onEvent({ type: 'run.succeeded', id: 'ev-end' });
          opts?.onDone?.();
        });
        return () => {};
      },
    );
    readFile.mockClear();
    listRevisions.mockClear();
    getRevision.mockClear();
    restoreRevision.mockClear();
    streamProjectFileEvents.mockClear();
    sseHandler = null;
    readFile.mockImplementation(async (_pid: string, path: string) => ({
      ok: true,
      data: {
        path,
        content: path === 'index.html' ? '<html><body><h1 id="hero">Hi</h1></body></html>' : 'body{}',
        hash: 'abc',
      },
    }));
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev1',
          projectId: 'p1',
          path: 'index.html',
          contentHash: 'deadbeef01',
          source: 'user',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getRevision.mockResolvedValue({
      ok: true,
      data: {
        id: 'rev1',
        projectId: 'p1',
        path: 'index.html',
        contentHash: 'deadbeef01',
        source: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        content: '<html><body>old</body></html>',
      },
    });
    restoreRevision.mockResolvedValue({
      ok: true,
      data: { path: 'index.html', hash: 'restored-h' },
    });
    getRun.mockResolvedValue({ ok: true, data: { id: 'run1', status: 'succeeded' } });
    listRuns.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'run-abc',
          status: 'running',
          projectId: 'p1',
          prompt: 'Make the hero blue',
          createdAt: '2026-01-02T00:00:00.000Z',
          eventCount: 2,
        },
      ],
    });
    listRunEvents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ev1',
          type: 'run.started',
          ts: '2026-01-02T00:00:01.000Z',
        },
        {
          id: 'ev2',
          type: 'run.stdout',
          ts: '2026-01-02T00:00:02.000Z',
          data: { chunk: 'hello from agent' },
        },
      ],
    });
    cancelRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-abc', status: 'canceled' },
    });
  });

  it('loads project and shows Design Editor for entry file', async () => {
    renderProject();
    await waitFor(() => {
      expect(screen.getByTestId('design-editor')).toBeInTheDocument();
    });
    expect(screen.getByTestId('editor-path').textContent).toBe('index.html');
    expect(screen.getByTestId('file-tree')).toBeInTheDocument();
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });

  it('edits and saves via Design Editor host', async () => {
    renderProject();
    await waitFor(() => screen.getByTestId('file-editor'));
    const ta = screen.getByTestId('file-editor') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '<html><body>v2</body></html>' } });
    await waitFor(() => expect(screen.getByTestId('web-dirty')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('file-save'));
    await waitFor(() => {
      expect(writeFile).toHaveBeenCalled();
      const args = writeFile.mock.calls.at(-1) as unknown as [
        string,
        string,
        string,
        { sessionId?: string } | undefined,
      ];
      expect(args[0]).toBe('p1');
      expect(args[1]).toBe('index.html');
      expect(args[2]).toBe('<html><body>v2</body></html>');
      // collabSessionId when presence ready → { sessionId }; else undefined
      if (args[3] !== undefined) {
        expect(args[3]).toEqual(
          expect.objectContaining({ sessionId: expect.any(String) }),
        );
      }
    });
  });

  it('runs Edit with AI with prompt and reloads after terminal status', async () => {
    renderProject();
    await waitFor(() => screen.getByTestId('ai-prompt'));
    fireEvent.change(screen.getByTestId('ai-prompt'), {
      target: { value: 'Make the hero blue' },
    });
    fireEvent.click(screen.getByTestId('ai-run'));
    await waitFor(() => {
      expect(createRun).toHaveBeenCalled();
    });
    const calls = createRun.mock.calls as unknown as Array<[ { projectId: string; prompt: string } ]>;
    const arg = calls[0]?.[0];
    expect(arg?.projectId).toBe('p1');
    expect(arg?.prompt).toMatch(/hero blue/i);
    // Prefers run event SSE (desktop parity)
    await waitFor(() => {
      expect(streamRunEvents).toHaveBeenCalledWith(
        'run1',
        expect.any(Function),
        expect.objectContaining({ onDone: expect.any(Function) }),
      );
    });
    await waitFor(() => {
      expect(getRun).toHaveBeenCalledWith('run1');
    });
    await waitFor(() => {
      // initial load + post-run reload
      expect(readFile.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    await waitFor(() => {
      expect(screen.getByTestId('web-ai-run-status')).toHaveTextContent(/succeeded/i);
    });
  });

  it('falls back to listRunEvents poll when run stream errors', async () => {
    streamRunEvents.mockImplementation(
      (
        _runId: string,
        _onEvent: RunSseHandler,
        opts?: { onDone?: () => void; onError?: (err: unknown) => void },
      ) => {
        queueMicrotask(() => opts?.onError?.(new Error('stream down')));
        return () => {};
      },
    );
    getRun
      .mockResolvedValueOnce({ ok: true, data: { id: 'run1', status: 'running' } })
      .mockResolvedValue({ ok: true, data: { id: 'run1', status: 'succeeded' } });
    renderProject();
    await waitFor(() => screen.getByTestId('ai-prompt'));
    fireEvent.change(screen.getByTestId('ai-prompt'), {
      target: { value: 'retry path' },
    });
    fireEvent.click(screen.getByTestId('ai-run'));
    await waitFor(() => expect(streamRunEvents).toHaveBeenCalled());
    await waitFor(() => {
      expect(listRunEvents).toHaveBeenCalledWith('run1', undefined);
    });
    await waitFor(() => {
      expect(getRun).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId('web-ai-run-status')).toHaveTextContent(/succeeded/i);
    });
  });

  it('renders colored status badges in runs list', async () => {
    renderProject();
    await waitFor(() => {
      expect(screen.getByTestId('web-run-status-run-abc')).toBeInTheDocument();
    });
    expect(screen.getByTestId('web-run-status-run-abc')).toHaveTextContent('running');
  });

  it('shows conflict banner when dirty and SSE disk tip changes', async () => {
    renderProject();
    await waitFor(() => screen.getByTestId('file-editor'));
    fireEvent.change(screen.getByTestId('file-editor'), {
      target: { value: '<html><body>mine</body></html>' },
    });
    await waitFor(() => expect(screen.getByTestId('web-dirty')).toBeInTheDocument());

    const readsBefore = readFile.mock.calls.length;
    readFile.mockImplementation(async () => ({
      ok: true,
      data: { path: 'index.html', content: '<html><body>agent</body></html>', hash: 'agent-h' },
    }));
    expect(sseHandler).toBeTruthy();
    sseHandler?.({ type: 'file.changed', path: 'index.html', hash: 'agent-h' });
    await waitFor(() => {
      expect(screen.getByTestId('conflict-banner')).toBeInTheDocument();
    });
    expect(readFile.mock.calls.length).toBeGreaterThan(readsBefore);
    fireEvent.click(screen.getByTestId('conflict-take'));
    await waitFor(() => {
      expect(screen.queryByTestId('conflict-banner')).not.toBeInTheDocument();
    });
    expect((screen.getByTestId('file-editor') as HTMLTextAreaElement).value).toContain('agent');
  });

  it('skips re-read when SSE hash matches known disk tip', async () => {
    renderProject();
    await waitFor(() => screen.getByTestId('file-editor'));
    const readsAfterLoad = readFile.mock.calls.length;
    expect(sseHandler).toBeTruthy();
    sseHandler?.({ type: 'file.changed', path: 'index.html', hash: 'abc' });
    // allow microtasks
    await new Promise((r) => setTimeout(r, 30));
    expect(readFile.mock.calls.length).toBe(readsAfterLoad);
    expect(screen.queryByTestId('conflict-banner')).not.toBeInTheDocument();
  });

  it('lists revisions for the open file', async () => {
    renderProject();
    await waitFor(() => {
      expect(screen.getByTestId('web-revisions')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(listRevisions).toHaveBeenCalledWith('p1', 'index.html');
    });
    expect(screen.getByTestId('web-revision-rev1')).toBeInTheDocument();
    expect(screen.getByText(/user · deadbeef/i)).toBeInTheDocument();
  });

  it('views a revision and shows content preview', async () => {
    renderProject();
    await waitFor(() => screen.getByTestId('web-revision-view-rev1'));
    fireEvent.click(screen.getByTestId('web-revision-view-rev1'));
    await waitFor(() => {
      expect(getRevision).toHaveBeenCalledWith('p1', 'rev1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('web-revision-preview')).toBeInTheDocument();
    });
    expect(screen.getByTestId('web-revision-preview').textContent).toContain(
      '<html><body>old</body></html>',
    );
  });

  it('restores a revision and reloads buffer from disk', async () => {
    renderProject();
    await waitFor(() => screen.getByTestId('web-revision-restore-rev1'));
    const readsBefore = readFile.mock.calls.length;
    readFile.mockImplementation(async () => ({
      ok: true,
      data: {
        path: 'index.html',
        content: '<html><body>restored-body</body></html>',
        hash: 'restored-h',
      },
    }));
    fireEvent.click(screen.getByTestId('web-revision-restore-rev1'));
    await waitFor(() => {
      expect(restoreRevision).toHaveBeenCalled();
      const args = restoreRevision.mock.calls.at(-1) as unknown as [
        string,
        string,
        { sessionId?: string } | undefined,
      ];
      expect(args[0]).toBe('p1');
      expect(args[1]).toBe('rev1');
      if (args[2] !== undefined) {
        expect(args[2]).toEqual(
          expect.objectContaining({ sessionId: expect.any(String) }),
        );
      }
    });
    await waitFor(() => {
      expect(readFile.mock.calls.length).toBeGreaterThan(readsBefore);
    });
    await waitFor(() => {
      expect((screen.getByTestId('file-editor') as HTMLTextAreaElement).value).toContain(
        'restored-body',
      );
    });
    expect(listRevisions.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('shows runs when mocked', async () => {
    renderProject();
    await waitFor(() => {
      expect(screen.getByTestId('web-runs')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(listRuns).toHaveBeenCalledWith('p1');
    });
    expect(screen.getByTestId('web-run-run-abc')).toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();
    expect(screen.getByText(/Make the hero blue/i)).toBeInTheDocument();
  });

  it('cancel calls cancelRun and refreshes list', async () => {
    listRuns
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            id: 'run-abc',
            status: 'running',
            projectId: 'p1',
            prompt: 'Make the hero blue',
            createdAt: '2026-01-02T00:00:00.000Z',
            eventCount: 2,
          },
        ],
      })
      .mockResolvedValue({
        ok: true,
        data: [
          {
            id: 'run-abc',
            status: 'canceled',
            projectId: 'p1',
            prompt: 'Make the hero blue',
            createdAt: '2026-01-02T00:00:00.000Z',
            eventCount: 3,
          },
        ],
      });
    renderProject();
    await waitFor(() => screen.getByTestId('web-run-cancel-run-abc'));
    fireEvent.click(screen.getByTestId('web-run-cancel-run-abc'));
    await waitFor(() => {
      expect(cancelRun).toHaveBeenCalledWith('run-abc');
    });
    await waitFor(() => {
      expect(listRuns.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('expand/select shows run events', async () => {
    renderProject();
    await waitFor(() => screen.getByTestId('web-run-run-abc'));
    fireEvent.click(screen.getByTestId('web-run-run-abc').querySelector('button')!);
    await waitFor(() => {
      expect(listRunEvents).toHaveBeenCalledWith('run-abc');
    });
    await waitFor(() => {
      expect(screen.getByTestId('web-run-events')).toBeInTheDocument();
    });
    expect(screen.getByTestId('web-run-events').textContent).toMatch(/run\.started/);
    expect(screen.getByTestId('web-run-events').textContent).toMatch(/run\.stdout/);
    expect(screen.getByTestId('web-run-events').textContent).toMatch(/hello from agent/);
  });
});
