import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getProject = vi.fn();
const listProjectFiles = vi.fn();
const readProjectFile = vi.fn();
const writeProjectFile = vi.fn();
const deleteProjectFile = vi.fn();
const mkdirProjectPath = vi.fn();
const listProjectPreviewComments = vi.fn();
const createProjectPreviewComment = vi.fn();
const deleteProjectPreviewComment = vi.fn();
const listProjectRevisions = vi.fn();
const getProjectRevision = vi.fn();
const restoreProjectRevision = vi.fn();
const listDesignSystems = vi.fn();
const getDesignSystemContent = vi.fn();
const getDesignSystemTokens = vi.fn();
const getDesignSystemRules = vi.fn();
const appendDesignSystemRules = vi.fn();
const pruneDesignSystemRules = vi.fn();
const getDesignSystemComponents = vi.fn();
const listDesignSystemStarters = vi.fn();
const getDesignSystemStarter = vi.fn();
const pinDesignSystemStarter = vi.fn();
const saveDesignSystemStarter = vi.fn();
const updateProject = vi.fn();
const createProjectRun = vi.fn();
const listProjectRunEvents = vi.fn();
const getProjectRun = vi.fn();
const cancelProjectRun = vi.fn();
const listProjectConversations = vi.fn(async () => ({ ok: true, data: [] as unknown[] }));
const createProjectConversation = vi.fn(async () => ({
  ok: true,
  data: {
    id: 'conv-1',
    projectId: 'proj-1',
    title: 'Project chat',
    createdAt: 't0',
    updatedAt: 't0',
  },
}));
const listProjectMessages = vi.fn(async () => ({ ok: true, data: [] as unknown[] }));
const addProjectMessage = vi.fn(async () => ({
  ok: true,
  data: {
    id: 'msg-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'hi',
    createdAt: 't0',
  },
}));
const listLiveArtifacts = vi.fn();
const createLiveArtifact = vi.fn();
const refreshLiveArtifact = vi.fn();
const deleteLiveArtifact = vi.fn();
const streamProjectFileEvents = vi.fn(() => () => {});
const streamProjectRunEvents = vi.fn(
  (
    _runId: string,
    _onEvent: (event: { type: string; id?: string; ts?: string; data?: unknown }) => void,
    _opts?: { onDone?: () => void; onError?: (err: unknown) => void },
  ) => () => {},
);
const streamProjectCollab = vi.fn(() => () => {});
const collabLock = vi.fn(async () => ({ ok: true, data: {} }));
const collabSelection = vi.fn(async () => ({ ok: true, data: {} }));
const listCollabPeers = vi.fn(async () => ({ ok: true, data: { peers: [] } }));
const listCollabLocks = vi.fn(async () => ({ ok: true, data: { locks: [] } }));
const listCollabSelections = vi.fn(async () => ({ ok: true, data: { selections: [] } }));
const collabHeartbeat = vi.fn(async () => ({ ok: true, data: { touched: true } }));

const client = {
  getProject,
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
  deleteProjectFile,
  mkdirProjectPath,
  listProjectPreviewComments,
  createProjectPreviewComment,
  deleteProjectPreviewComment,
  listProjectRevisions,
  getProjectRevision,
  restoreProjectRevision,
  listDesignSystems,
  getDesignSystemContent,
  getDesignSystemTokens,
  getDesignSystemRules,
  appendDesignSystemRules,
  pruneDesignSystemRules,
  getDesignSystemComponents,
  listDesignSystemStarters,
  getDesignSystemStarter,
  pinDesignSystemStarter,
  saveDesignSystemStarter,
  updateProject,
  createProjectRun,
  listProjectRunEvents,
  getProjectRun,
  cancelProjectRun,
  listProjectConversations,
  createProjectConversation,
  listProjectMessages,
  addProjectMessage,
  listLiveArtifacts,
  createLiveArtifact,
  refreshLiveArtifact,
  deleteLiveArtifact,
  streamProjectFileEvents,
  streamProjectRunEvents,
  streamProjectCollab,
  collabLock,
  collabSelection,
  listCollabPeers,
  listCollabLocks,
  listCollabSelections,
  collabHeartbeat,
};

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({ client }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useBlocker: () => ({ state: 'unblocked' as const }),
  };
});

vi.mock('../components/workflow/ConfirmLeaveModal.js', () => ({
  ConfirmLeaveModal: () => <div data-testid="confirm-leave">leave</div>,
}));

vi.mock('react-i18next', () => {
  // Stable t identity — avoids re-creating loadLiveArtifacts/loadProject each render
  const t = (key: string, opts?: Record<string, string>) =>
    opts?.selector ? `${key}:${opts.selector}` : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en' } }),
  };
});

// Lightweight mock — avoid requiring built dist for unit tests
vi.mock('@neos-work/office-sheets/ui', () => ({
  SheetsPane: () => <div data-testid="sheets-pane">sheets</div>,
}));

vi.mock('@neos-work/design-editor', () => {
  type Buf = {
    path: string | null;
    local: string;
    disk: string;
    diskHash: string | null;
  };
  return {
    createEmptyBuffer: (): Buf => ({ path: null, local: '', disk: '', diskHash: null }),
    editContextFromSelection: (
      selection: { filePath: string; selector?: string },
      opts?: { snippet?: string; mode?: string },
    ) => ({
      filePath: selection.filePath,
      mode: opts?.mode ?? 'replace-selection',
      selection: selection.selector ? { selector: selection.selector } : undefined,
      snippet: opts?.snippet,
    }),
    isDirty: (b: Buf) => b.local !== b.disk,
    shouldSkipDiskReload: (
      b: Buf,
      event: { path?: string | null; hash?: string | null },
    ) => {
      if (b.path == null) return true;
      const p = typeof event.path === 'string' ? event.path : '';
      if (p && p !== b.path) return true;
      const hash = typeof event.hash === 'string' && event.hash ? event.hash : null;
      if (!hash) return false;
      return b.diskHash != null && b.diskHash === hash;
    },
    reduceEditorBuffer: (
      prev: Buf,
      event:
        | { type: 'open'; path: string; content: string; hash?: string }
        | { type: 'edit'; content: string }
        | { type: 'saved'; content: string; hash?: string }
        | { type: 'resolve-conflict'; choice: string; merged?: string },
    ): Buf => {
      if (event.type === 'open') {
        return {
          path: event.path,
          local: event.content,
          disk: event.content,
          diskHash: event.hash ?? null,
        };
      }
      if (event.type === 'edit') {
        return { ...prev, local: event.content };
      }
      if (event.type === 'saved') {
        return {
          ...prev,
          local: event.content,
          disk: event.content,
          diskHash: event.hash ?? prev.diskHash,
        };
      }
      if ((event as { type?: string }).type === 'disk-changed') {
        const e = event as { type: 'disk-changed'; content: string; hash?: string };
        // Mirror production: if dirty, keep local and only update disk/hash
        if (prev.local !== prev.disk) {
          return {
            ...prev,
            disk: e.content,
            diskHash: e.hash ?? prev.diskHash,
          };
        }
        return {
          ...prev,
          local: e.content,
          disk: e.content,
          diskHash: e.hash ?? prev.diskHash,
        };
      }
      return prev;
    },
    DesignEditor: (props: {
      buffer: Buf;
      onEdit?: (v: string) => void;
      onSave?: () => void;
      onSelectionChange?: (
        sel: { filePath: string; selector?: string } | null,
        detail?: { outerHTML?: string },
      ) => void;
      onEditWithAi?: (
        sel: { filePath: string; selector?: string },
        detail?: { outerHTML?: string },
      ) => void;
      labels?: { code?: string; save?: string; dirty?: string };
      toolbarExtra?: unknown;
    }) => {
      const dirty = props.buffer.local !== props.buffer.disk;
      return (
        <div data-testid="design-editor">
          {props.toolbarExtra}
          {dirty && <span>{props.labels?.dirty ?? 'dirty'}</span>}
          <textarea
            aria-label={props.labels?.code ?? 'code'}
            value={props.buffer.local}
            onChange={(e) => props.onEdit?.(e.target.value)}
          />
          <button type="button" disabled={!dirty} onClick={() => props.onSave?.()}>
            {props.labels?.save ?? 'save'}
          </button>
          <button
            type="button"
            data-testid="mock-select"
            onClick={() =>
              props.onSelectionChange?.(
                { filePath: props.buffer.path ?? 'index.html', selector: '#hero' },
                { outerHTML: '<div id="hero">Hello</div>' },
              )
            }
          >
            select
          </button>
          <button
            type="button"
            data-testid="mock-select-long"
            onClick={() =>
              props.onSelectionChange?.(
                { filePath: props.buffer.path ?? 'index.html', selector: '#hero' },
                { outerHTML: 'x'.repeat(501) },
              )
            }
          >
            select-long
          </button>
          <button
            type="button"
            data-testid="mock-edit-ai"
            onClick={() =>
              props.onEditWithAi?.(
                { filePath: props.buffer.path ?? 'index.html', selector: '#hero' },
                { outerHTML: '<div id="hero">Hello</div>' },
              )
            }
          >
            edit-ai
          </button>
        </div>
      );
    },
  };
});

const { ProjectWorkspace } = await import('./ProjectWorkspace.js');

function renderWorkspace(id = 'proj-1') {
  return render(
    <MemoryRouter initialEntries={[`/projects/${id}`]}>
      <Routes>
        <Route path="/projects/:id" element={<ProjectWorkspace />} />
      </Routes>
    </MemoryRouter>,
  );
}

const baseProject = {
  id: 'proj-1',
  name: 'Demo',
  baseDir: '/tmp/demo',
  entryFile: 'index.html',
  designSystemId: null as string | null,
  meta: {},
  createdAt: 't',
  updatedAt: 't',
};

function mockLoadedProject(overrides?: Partial<typeof baseProject>) {
  getProject.mockResolvedValue({
    ok: true,
    data: { ...baseProject, ...overrides },
  });
  listProjectFiles.mockResolvedValue({
    ok: true,
    data: [
      { path: 'index.html', name: 'index.html', type: 'file', isEntry: true },
      { path: 'about.html', name: 'about.html', type: 'file', isEntry: false },
      { path: 'css', name: 'css', type: 'directory' },
    ],
  });
  readProjectFile.mockImplementation(async (_id: string, path: string) => ({
    ok: true,
    data: {
      path,
      content: path === 'about.html' ? '<html>about</html>' : '<html>hi</html>',
      hash: path === 'about.html' ? 'about-hash' : 'abc',
    },
  }));
}

function userDesignSystem(overrides?: Record<string, unknown>) {
  return {
    id: 'ds1',
    name: 'Brand',
    path: '/x',
    hasManifest: true,
    hasTokens: true,
    hasComponents: false,
    hasRules: true,
    source: 'user' as const,
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  };
}

async function openContext(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('side-tab-context'));
  await waitFor(() => expect(screen.getByTestId('project-context')).toBeInTheDocument());
}

async function openComments(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('side-tab-comments'));
  await waitFor(() => expect(screen.getByTestId('project-comments')).toBeInTheDocument());
}
function mockHtmlProject(
  files?: Array<{ path: string; name?: string; type?: 'file' | 'directory' }>,
  overrides?: Partial<typeof baseProject>,
) {
  mockLoadedProject(overrides);
  if (files) {
    const entry = overrides?.entryFile ?? 'index.html';
    listProjectFiles.mockResolvedValue({
      ok: true,
      data: files.map((f) => ({
        path: f.path,
        name: f.name ?? f.path.split('/').pop()!,
        type: f.type ?? 'file',
        isEntry: f.path === entry,
      })),
    });
  }
}

async function startSucceededRun(runId = 'run-var001') {
  createProjectRun.mockResolvedValue({ ok: true, data: { id: runId, status: 'running' } });
  streamProjectRunEvents.mockImplementation((_id, onEvent, opts) => {
    queueMicrotask(() => {
      onEvent({ type: 'run.started', id: 'ev1', ts: 't' });
      onEvent({ type: 'run.succeeded', id: 'ev2', ts: 't2' });
      opts?.onDone?.();
    });
    return () => {};
  });
  getProjectRun.mockResolvedValue({
    ok: true,
    data: { id: runId, status: 'succeeded', error: null },
  });
}

function boundDesignSystemRow(hasComponents = true) {
  return {
    id: 'ds1',
    name: 'neos-default',
    path: '/x',
    hasManifest: true,
    hasTokens: true,
    hasComponents,
    source: 'bundled' as const,
    createdAt: 't',
    updatedAt: 't',
  };
}
describe('ProjectWorkspace', () => {
  beforeEach(() => {
    getProject.mockReset();
    listProjectFiles.mockReset();
    readProjectFile.mockReset();
    writeProjectFile.mockReset();
    deleteProjectFile.mockReset();
    mkdirProjectPath.mockReset();
    listProjectPreviewComments.mockReset().mockResolvedValue({ ok: true, data: [] });
    createProjectPreviewComment.mockReset();
    deleteProjectPreviewComment.mockReset();
    listProjectRevisions.mockReset().mockResolvedValue({ ok: true, data: [] });
    getProjectRevision.mockReset();
    restoreProjectRevision.mockReset();
    listDesignSystems.mockReset().mockResolvedValue({ ok: true, data: [] });
    getDesignSystemContent.mockReset().mockResolvedValue({ ok: true, data: { content: '# DS' } });
    getDesignSystemTokens.mockReset().mockResolvedValue({ ok: true, data: { content: ':root{}' } });
    getDesignSystemRules.mockReset().mockResolvedValue({
      ok: true,
      data: { content: '## Never\n- no hex\n' },
    });
    appendDesignSystemRules.mockReset().mockResolvedValue({ ok: true });
    pruneDesignSystemRules.mockReset().mockResolvedValue({ ok: true, data: { pruned: 0 } });
    getDesignSystemComponents.mockReset().mockResolvedValue({
      ok: true,
      data: { content: '<button class="ds-btn">Ok</button>' },
    });
    listDesignSystemStarters.mockReset().mockResolvedValue({ ok: true, data: [] });
    getDesignSystemStarter.mockReset().mockResolvedValue({
      ok: true,
      data: { content: '<section>hero</section>' },
    });
    pinDesignSystemStarter.mockReset().mockResolvedValue({
      ok: true,
      data: { name: 'hero.html', bytes: 12, updatedAt: 't' },
    });
    saveDesignSystemStarter.mockReset();
    writeProjectFile.mockReset();
    updateProject.mockReset();
    createProjectRun.mockReset();
    listProjectRunEvents.mockReset();
    getProjectRun.mockReset();
    cancelProjectRun.mockReset();
    listProjectConversations.mockReset().mockResolvedValue({ ok: true, data: [] });
    createProjectConversation.mockReset().mockResolvedValue({
      ok: true,
      data: {
        id: 'conv-1',
        projectId: 'proj-1',
        title: 'Project chat',
        createdAt: 't0',
        updatedAt: 't0',
      },
    });
    listProjectMessages.mockReset().mockResolvedValue({ ok: true, data: [] });
    addProjectMessage.mockReset().mockImplementation(async (_p, _c, input: { content: string; role?: string }) => ({
      ok: true,
      data: {
        id: `msg-${Math.random().toString(36).slice(2, 8)}`,
        conversationId: 'conv-1',
        role: input.role ?? 'user',
        content: input.content,
        createdAt: new Date().toISOString(),
      },
    }));
    listLiveArtifacts.mockReset().mockResolvedValue({ ok: true, data: [] });
    createLiveArtifact.mockReset();
    refreshLiveArtifact.mockReset();
    deleteLiveArtifact.mockReset();
    streamProjectFileEvents.mockReset().mockImplementation(() => () => {});
    streamProjectRunEvents.mockReset().mockImplementation(() => () => {});
    streamProjectCollab.mockReset().mockImplementation(() => () => {});
    listCollabPeers.mockReset().mockResolvedValue({ ok: true, data: { peers: [] } });
    listCollabLocks.mockReset().mockResolvedValue({ ok: true, data: { locks: [] } });
    listCollabSelections.mockReset().mockResolvedValue({ ok: true, data: { selections: [] } });
    collabHeartbeat.mockReset().mockResolvedValue({ ok: true, data: { touched: true } });
    collabLock.mockReset().mockResolvedValue({ ok: true, data: {} });
    collabSelection.mockReset().mockResolvedValue({ ok: true, data: {} });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('loads project, shows files, saves dirty code via DesignEditor', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    writeProjectFile.mockResolvedValue({
      ok: true,
      data: { path: 'index.html', hash: 'def', bytes: 20, created: false },
    });

    renderWorkspace();

    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.getAllByText('index.html').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('design-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('sheets-pane')).not.toBeInTheDocument();

    const ta = screen.getByLabelText('project.mode.code') as HTMLTextAreaElement;
    await waitFor(() => expect(ta.value).toContain('hi'));
    fireEvent.change(ta, { target: { value: '<html>edited</html>' } });
    await waitFor(() => expect(screen.getByText('project.dirty')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(writeProjectFile).toHaveBeenCalled();
      const args = writeProjectFile.mock.calls.at(-1)!;
      expect(args[0]).toBe('proj-1');
      expect(args[1]).toBe('index.html');
      expect(args[2]).toBe('<html>edited</html>');
      expect(args[3]).toBe('user');
      // When presence session is ready, pass sessionId for hard-enforce lock holder writes
      if (args[4] !== undefined) {
        expect(args[4]).toEqual(
          expect.objectContaining({ sessionId: expect.any(String) }),
        );
      }
    });
  });

  it('shows error when project missing', async () => {
    getProject.mockResolvedValue({ ok: false, error: 'Not found' });
    renderWorkspace();
    await waitFor(() => {
      expect(screen.getByText('Not found')).toBeInTheDocument();
    });
  });

  it('shows error when getProject throws', async () => {
    getProject.mockRejectedValue(new Error('network down'));
    renderWorkspace();
    await waitFor(() => {
      expect(screen.getByText('network down')).toBeInTheDocument();
    });
  });

  it('falls back to first html file when entryFile is missing', async () => {
    getProject.mockResolvedValue({
      ok: true,
      data: { ...baseProject, entryFile: null },
    });
    listProjectFiles.mockResolvedValue({
      ok: true,
      data: [
        { path: 'styles.css', name: 'styles.css', type: 'file', isEntry: false },
        { path: 'page.html', name: 'page.html', type: 'file', isEntry: false },
      ],
    });
    readProjectFile.mockResolvedValue({
      ok: true,
      data: { path: 'page.html', content: '<html>page</html>', hash: 'p1' },
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await waitFor(() => {
      expect(readProjectFile).toHaveBeenCalledWith('proj-1', 'page.html');
    });
  });

  it('opens another file from the file tree', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /about\.html/i }));
    await waitFor(() => {
      expect(readProjectFile).toHaveBeenCalledWith('proj-1', 'about.html');
    });
    await waitFor(() => {
      expect((screen.getByLabelText('project.mode.code') as HTMLTextAreaElement).value).toContain(
        'about',
      );
    });
  });

  it('deletes a file from the tree with sessionId when collab ready', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    streamProjectCollab.mockImplementation(
      (_id: string, onEvent: (ev: { type: string; sessionId?: string }) => void) => {
        onEvent({ type: 'ready', sessionId: 'sess-delete-1' });
        return () => {};
      },
    );
    deleteProjectFile.mockResolvedValue({ ok: true, data: { path: 'about.html' } });
    listProjectFiles
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { path: 'index.html', name: 'index.html', type: 'file', isEntry: true },
          { path: 'about.html', name: 'about.html', type: 'file', isEntry: false },
        ],
      })
      .mockResolvedValue({
        ok: true,
        data: [{ path: 'index.html', name: 'index.html', type: 'file', isEntry: true }],
      });

    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('file-delete-about.html')).toBeInTheDocument());
    await user.click(screen.getByTestId('file-delete-about.html'));

    await waitFor(() => {
      expect(deleteProjectFile).toHaveBeenCalledWith('proj-1', 'about.html', {
        sessionId: 'sess-delete-1',
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('file-delete-about.html')).not.toBeInTheDocument();
    });
    expect(window.confirm).toHaveBeenCalled();
  });

  it('shows Locked by holder when delete returns 423 holder', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    deleteProjectFile.mockResolvedValue({
      ok: false,
      error: 'File locked by Alice',
      data: {
        holder: { sessionId: 'peer-a', displayName: 'Alice', path: 'about.html' },
      },
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('file-delete-about.html')).toBeInTheDocument());
    await user.click(screen.getByTestId('file-delete-about.html'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/fileLockedBy|Alice/i);
    });
    // lock chip appears on the locked path
    await waitFor(() => {
      expect(screen.getByTestId('file-lock-chip-about.html')).toBeInTheDocument();
    });
  });

  it('clears editor when deleting the open file', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    deleteProjectFile.mockResolvedValue({ ok: true, data: { path: 'index.html' } });
    listProjectFiles
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { path: 'index.html', name: 'index.html', type: 'file', isEntry: true },
          { path: 'about.html', name: 'about.html', type: 'file', isEntry: false },
        ],
      })
      .mockResolvedValue({
        ok: true,
        data: [{ path: 'about.html', name: 'about.html', type: 'file', isEntry: false }],
      });

    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('file-delete-index.html')).toBeInTheDocument());
    await waitFor(() => {
      expect((screen.getByLabelText('project.mode.code') as HTMLTextAreaElement).value).toContain(
        'hi',
      );
    });
    await user.click(screen.getByTestId('file-delete-index.html'));
    await waitFor(() => {
      expect(deleteProjectFile).toHaveBeenCalledWith('proj-1', 'index.html', undefined);
    });
    // buffer cleared — DesignEditor still mounted but empty / no path chrome
    await waitFor(() => {
      const ta = screen.queryByLabelText('project.mode.code') as HTMLTextAreaElement | null;
      if (ta) expect(ta.value).toBe('');
    });
  });

  it('does not delete when confirm is cancelled', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('file-delete-about.html')).toBeInTheDocument());
    await user.click(screen.getByTestId('file-delete-about.html'));
    expect(deleteProjectFile).not.toHaveBeenCalled();
  });

  it('creates a folder via mkdir and reloads the file tree', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    vi.spyOn(window, 'prompt').mockReturnValue('assets/icons');
    mkdirProjectPath.mockResolvedValue({ ok: true, data: { path: 'assets/icons' } });
    listProjectFiles
      .mockResolvedValueOnce({
        ok: true,
        data: [
          { path: 'index.html', name: 'index.html', type: 'file', isEntry: true },
          { path: 'about.html', name: 'about.html', type: 'file', isEntry: false },
        ],
      })
      .mockResolvedValue({
        ok: true,
        data: [
          { path: 'index.html', name: 'index.html', type: 'file', isEntry: true },
          { path: 'about.html', name: 'about.html', type: 'file', isEntry: false },
          { path: 'assets', name: 'assets', type: 'directory', isEntry: false },
          { path: 'assets/icons', name: 'icons', type: 'directory', isEntry: false },
        ],
      });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('project-mkdir')).toBeInTheDocument());
    await user.click(screen.getByTestId('project-mkdir'));
    await waitFor(() => {
      expect(mkdirProjectPath).toHaveBeenCalledWith('proj-1', 'assets/icons', undefined);
    });
    await waitFor(() => {
      expect(screen.getByText('icons')).toBeInTheDocument();
    });
  });

  it('surfaces mkdir lock holder on 423', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    vi.spyOn(window, 'prompt').mockReturnValue('locked-dir');
    mkdirProjectPath.mockResolvedValue({
      ok: false,
      error: 'File locked',
      data: {
        holder: { sessionId: 'peer-b', displayName: 'Bob', path: 'locked-dir' },
      },
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('project-mkdir')).toBeInTheDocument());
    await user.click(screen.getByTestId('project-mkdir'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/fileLockedBy|Bob/i);
    });
  });

  it('shows save error when write fails', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    writeProjectFile.mockResolvedValue({ ok: false, error: 'disk full' });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    const ta = screen.getByLabelText('project.mode.code') as HTMLTextAreaElement;
    await waitFor(() => expect(ta.value).toContain('hi'));
    fireEvent.change(ta, { target: { value: '<html>x</html>' } });
    await user.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('disk full'));
  });

  it('shows read error when opening a file fails', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    readProjectFile.mockResolvedValueOnce({ ok: false, error: 'missing file' });
    await user.click(screen.getByRole('button', { name: /about\.html/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('missing file'));
  });

  it('switches to context tab and loads design systems', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ds1',
          name: 'neos-default',
          path: '/x',
          hasManifest: true,
          hasTokens: true,
          hasComponents: false,
          source: 'bundled',
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-context'));
    await waitFor(() => {
      expect(listDesignSystems).toHaveBeenCalled();
      expect(screen.getByTestId('project-context')).toBeInTheDocument();
    });
  });

  it('links a design system and previews content/tokens', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ds1',
          name: 'neos-default',
          path: '/x',
          hasManifest: true,
          hasTokens: true,
          hasComponents: false,
          source: 'bundled',
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    });
    updateProject.mockResolvedValue({
      ok: true,
      data: { ...baseProject, designSystemId: 'ds1' },
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-context'));
    await waitFor(() => expect(screen.getByTestId('project-ds-select')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('project-ds-select'), 'ds1');
    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith('proj-1', { designSystemId: 'ds1' });
    });
    await waitFor(() => {
      expect(getDesignSystemContent).toHaveBeenCalledWith('ds1');
      expect(getDesignSystemTokens).toHaveBeenCalledWith('ds1');
      expect(screen.getByText('# DS')).toBeInTheDocument();
      expect(screen.getByText(':root{}')).toBeInTheDocument();
    });
  });

  it('shows design system update error', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ds1',
          name: 'neos-default',
          path: '/x',
          hasManifest: true,
          hasTokens: true,
          hasComponents: false,
          source: 'bundled',
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    });
    updateProject.mockResolvedValue({ ok: false, error: 'cannot link' });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-context'));
    await waitFor(() => expect(screen.getByTestId('project-ds-select')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('project-ds-select'), 'ds1');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('cannot link'));
  });

  it('loads linked design system context on open of context tab', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ds1',
          name: 'neos-default',
          path: '/x',
          hasManifest: true,
          hasTokens: true,
          hasComponents: false,
          source: 'bundled',
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-context'));
    await waitFor(() => {
      expect(getDesignSystemContent).toHaveBeenCalledWith('ds1');
      expect(screen.getByText('# DS')).toBeInTheDocument();
    });
  });

  it('context tab previews RULES.md 6k slice with DESIGN and tokens', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ds1',
          name: 'neos-default',
          path: '/x',
          hasManifest: true,
          hasTokens: true,
          hasComponents: false,
          source: 'bundled',
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-context'));
    await waitFor(() => {
      expect(getDesignSystemContent).toHaveBeenCalledWith('ds1');
      expect(getDesignSystemTokens).toHaveBeenCalledWith('ds1');
      expect(getDesignSystemRules).toHaveBeenCalledWith('ds1');
      expect(screen.getByText('RULES.md')).toBeInTheDocument();
      expect(screen.getByText(/## Never/)).toBeInTheDocument();
    });
  });

  it('RULES preview slices to 6000 characters', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    getDesignSystemRules.mockResolvedValue({
      ok: true,
      data: { content: `${'A'.repeat(6000)}TAIL-MARKER` },
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-context'));
    await waitFor(() => {
      expect(getDesignSystemRules).toHaveBeenCalledWith('ds1');
      expect(screen.getByText('RULES.md')).toBeInTheDocument();
    });
    const preview = screen.getByTestId('project-ds-preview');
    expect(preview.textContent).not.toContain('TAIL-MARKER');
    expect(preview.textContent).toContain('A'.repeat(32));
  });

  it('omits RULES preview on GET 404 and does not error the panel if DESIGN loaded', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    getDesignSystemRules.mockResolvedValue({ ok: false, error: 'Not found' });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-context'));
    await waitFor(() => {
      expect(screen.getByText('# DS')).toBeInTheDocument();
    });
    expect(screen.queryByText('RULES.md')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('switches to comments and revisions side tabs', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.getByTestId('project-side-panel')).toBeInTheDocument();

    await user.click(screen.getByTestId('side-tab-comments'));
    await waitFor(() => {
      expect(listProjectPreviewComments).toHaveBeenCalled();
      expect(screen.getByTestId('project-comments')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('side-tab-revisions'));
    await waitFor(() => {
      expect(listProjectRevisions).toHaveBeenCalledWith('proj-1', 'index.html');
      expect(screen.getByTestId('project-revisions')).toBeInTheDocument();
    });
  });

  it('adds and deletes a preview comment after selection', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    // Stateful list so StrictMode double-fetch / post-create reload stay consistent
    let comments: Array<{
      id: string;
      projectId: string;
      filePath: string;
      selector: string;
      body: string;
      createdAt: string;
    }> = [];
    listProjectPreviewComments.mockImplementation(async () => ({ ok: true, data: comments }));
    createProjectPreviewComment.mockImplementation(async (_id: string, input: {
      filePath: string;
      selector: string;
      body: string;
    }) => {
      const row = {
        id: 'c1',
        projectId: 'proj-1',
        filePath: input.filePath,
        selector: input.selector,
        body: input.body,
        createdAt: 't',
      };
      comments = [row];
      return { ok: true, data: row };
    });
    deleteProjectPreviewComment.mockImplementation(async () => {
      comments = [];
      return { ok: true, data: { deleted: true } };
    });

    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('mock-select'));
    await user.click(screen.getByTestId('side-tab-comments'));
    await waitFor(() => expect(screen.getByTestId('project-comments')).toBeInTheDocument());
    expect(screen.getByText('#hero')).toBeInTheDocument();

    await user.type(screen.getByLabelText('project.comments'), 'tighten spacing');
    await user.click(screen.getByTestId('comment-add'));
    await waitFor(() => {
      expect(createProjectPreviewComment).toHaveBeenCalledWith('proj-1', {
        filePath: 'index.html',
        selector: '#hero',
        body: 'tighten spacing',
      });
    });
    await waitFor(() => expect(screen.getByTestId('comment-c1')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'common.delete' }));
    await waitFor(() => {
      expect(deleteProjectPreviewComment).toHaveBeenCalledWith('proj-1', 'c1');
    });
  });

  it('shows comment error when create fails', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    createProjectPreviewComment.mockResolvedValue({ ok: false, error: 'comment blocked' });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('mock-select'));
    await user.click(screen.getByTestId('side-tab-comments'));
    await user.type(screen.getByLabelText('project.comments'), 'note');
    await user.click(screen.getByTestId('comment-add'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('comment blocked'));
  });

  it('views a revision snapshot then restores content', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listProjectRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          projectId: 'proj-1',
          path: 'index.html',
          source: 'user',
          contentHash: 'deadbeef',
          createdAt: '2026-01-01',
        },
      ],
    });
    getProjectRevision.mockResolvedValue({
      ok: true,
      data: {
        id: 'rev-1',
        projectId: 'proj-1',
        path: 'index.html',
        source: 'user',
        contentHash: 'deadbeef',
        content: '<html>old-snap</html>',
        createdAt: '2026-01-01',
      },
    });
    restoreProjectRevision.mockResolvedValue({
      ok: true,
      data: { path: 'index.html', restored: true },
    });
    readProjectFile
      .mockResolvedValueOnce({
        ok: true,
        data: { path: 'index.html', content: '<html>hi</html>', hash: 'abc' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { path: 'index.html', content: '<html>restored</html>', hash: 'rest' },
      });

    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-revisions'));
    await waitFor(() => expect(screen.getByTestId('revision-rev-1')).toBeInTheDocument());
    await user.click(screen.getByTestId('revision-view-rev-1'));
    await waitFor(() => {
      expect(getProjectRevision).toHaveBeenCalledWith('proj-1', 'rev-1');
      expect(screen.getByTestId('revision-preview')).toHaveTextContent('old-snap');
    });
    await user.click(screen.getByRole('button', { name: 'project.restore' }));
    await waitFor(() => {
      expect(restoreProjectRevision).toHaveBeenCalled();
      const args = restoreProjectRevision.mock.calls.at(-1)!;
      expect(args[0]).toBe('proj-1');
      expect(args[1]).toBe('rev-1');
      // collabSessionId when presence ready → { sessionId }; else undefined
      if (args[2] !== undefined) {
        expect(args[2]).toEqual(
          expect.objectContaining({ sessionId: expect.any(String) }),
        );
      }
    });
    await waitFor(() => {
      expect((screen.getByLabelText('project.mode.code') as HTMLTextAreaElement).value).toContain(
        'restored',
      );
    });
  });

  it('shows revision restore error', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listProjectRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          projectId: 'proj-1',
          path: 'index.html',
          source: 'user',
          contentHash: 'deadbeef',
          createdAt: '2026-01-01',
        },
      ],
    });
    restoreProjectRevision.mockResolvedValue({ ok: false, error: 'restore denied' });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-revisions'));
    await waitFor(() => expect(screen.getByTestId('revision-rev-1')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'project.restore' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('restore denied'));
  });

  it('sends dry-run chat and streams run events until succeeded', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    createProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-abcdef01', status: 'running' },
    });
    streamProjectRunEvents.mockImplementation((_runId, onEvent, opts) => {
      queueMicrotask(() => {
        onEvent({
          type: 'run.stdout',
          id: 'ev1',
          ts: 't',
          data: { chunk: 'hello from dry-run' },
        });
        opts?.onDone?.();
      });
      return () => {};
    });
    getProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-abcdef01', status: 'succeeded', error: null },
    });

    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.getByTestId('project-chat')).toBeInTheDocument();
    await user.type(screen.getByLabelText('project.chat'), 'Improve the hero');
    await user.click(screen.getByRole('button', { name: 'project.chatSend' }));

    await waitFor(() => {
      expect(createProjectRun).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          prompt: 'Improve the hero',
          dryRun: true,
          editContext: expect.objectContaining({
            filePath: 'index.html',
            mode: 'patch',
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(streamProjectRunEvents).toHaveBeenCalledWith(
        'run-abcdef01',
        expect.any(Function),
        expect.objectContaining({
          onDone: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
      expect(getProjectRun).toHaveBeenCalledWith('run-abcdef01');
      const log = screen.getByTestId('project-chat-log');
      expect(log.textContent).toMatch(/run\.stdout/);
      expect(log.textContent).toMatch(/succeeded/);
    });
    expect(listProjectRunEvents).not.toHaveBeenCalled();
    // Persists user + assistant turns via project conversations API
    await waitFor(() => {
      expect(createProjectConversation).toHaveBeenCalled();
      expect(addProjectMessage).toHaveBeenCalledWith(
        'proj-1',
        'conv-1',
        expect.objectContaining({ role: 'user', content: 'Improve the hero' }),
      );
      expect(addProjectMessage).toHaveBeenCalledWith(
        'proj-1',
        'conv-1',
        expect.objectContaining({ role: 'assistant' }),
      );
    });
  });

  it('cancels an active chat run, aborts SSE, and shows canceled status', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    createProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-cancel01', status: 'running' },
    });
    let streamStop: (() => void) | null = null;
    streamProjectRunEvents.mockImplementation((_runId, _onEvent, opts) => {
      // Stay open until cancel aborts (stop resolves the send await)
      streamStop = () => {
        // engine abort path: neither onDone nor onError — component stop wrapper resolves
      };
      return () => {
        streamStop?.();
        streamStop = null;
      };
    });
    cancelProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-cancel01', status: 'canceled' },
    });

    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.type(screen.getByLabelText('project.chat'), 'long running task');
    await user.click(screen.getByRole('button', { name: 'project.chatSend' }));

    await waitFor(() => {
      expect(createProjectRun).toHaveBeenCalled();
      expect(streamProjectRunEvents).toHaveBeenCalledWith(
        'run-cancel01',
        expect.any(Function),
        expect.any(Object),
      );
      expect(screen.getByTestId('project-run-status')).toHaveTextContent('running');
      expect(screen.getByTestId('project-run-cancel')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('project-run-cancel'));

    await waitFor(() => {
      expect(cancelProjectRun).toHaveBeenCalledWith('run-cancel01');
      expect(screen.getByTestId('project-run-status')).toHaveTextContent('canceled');
      const log = screen.getByTestId('project-chat-log');
      expect(log.textContent).toMatch(/canceled/);
    });
    // Cancel button hidden once terminal
    await waitFor(() => {
      expect(screen.queryByTestId('project-run-cancel')).not.toBeInTheDocument();
    });
  });

  it('handles cancel 409 already-terminal by refreshing run status', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    createProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-term409', status: 'running' },
    });
    streamProjectRunEvents.mockImplementation(() => () => {});
    cancelProjectRun.mockResolvedValue({
      ok: false,
      error: 'Run already terminal',
    });
    getProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-term409', status: 'succeeded', error: null },
    });

    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.type(screen.getByLabelText('project.chat'), 'already done');
    await user.click(screen.getByRole('button', { name: 'project.chatSend' }));

    await waitFor(() => expect(screen.getByTestId('project-run-cancel')).toBeInTheDocument());
    await user.click(screen.getByTestId('project-run-cancel'));

    await waitFor(() => {
      expect(cancelProjectRun).toHaveBeenCalledWith('run-term409');
      expect(getProjectRun).toHaveBeenCalledWith('run-term409');
      expect(screen.getByTestId('project-run-status')).toHaveTextContent('succeeded');
      expect(screen.getByTestId('project-chat-log').textContent).toMatch(/succeeded/);
    });
  });

  it('rejects chat prompts containing null bytes', async () => {
    mockLoadedProject();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    const ta = screen.getByLabelText('project.chat') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'bad\0prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'project.chatSend' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('project.chatInvalid'));
    expect(createProjectRun).not.toHaveBeenCalled();
  });

  it('shows chat error when createProjectRun fails', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    createProjectRun.mockResolvedValue({ ok: false, error: 'agent offline' });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.type(screen.getByLabelText('project.chat'), 'do something');
    await user.click(screen.getByRole('button', { name: 'project.chatSend' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('agent offline'));
  });

  it('seeds chat prompt via edit-with-ai selection', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('mock-edit-ai'));
    await waitFor(() => {
      const ta = screen.getByLabelText('project.chat') as HTMLTextAreaElement;
      expect(ta.value).toContain('project.editWithAiHint');
    });
  });

  it('sends live agent chat with selection context and reloads files on success', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    createProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-live001', status: 'running' },
    });
    streamProjectRunEvents.mockImplementation((_runId, onEvent, opts) => {
      queueMicrotask(() => {
        onEvent({ type: 'run.started', id: 'ev1', ts: 't' });
        onEvent({ type: 'run.succeeded', id: 'ev2', ts: 't2' });
        opts?.onDone?.();
      });
      return () => {};
    });
    getProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-live001', status: 'succeeded', error: null },
    });

    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('mock-select'));
    await user.selectOptions(screen.getByLabelText('project.chatAgent'), 'cli-claude');
    await user.type(screen.getByLabelText('project.chat'), 'fix the hero');
    await user.click(screen.getByRole('button', { name: 'project.chatSend' }));

    await waitFor(() => {
      expect(createProjectRun).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'cli-claude',
          dryRun: false,
          editContext: expect.objectContaining({
            mode: 'replace-selection',
            snippet: '<div id="hero">Hello</div>',
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(streamProjectRunEvents).toHaveBeenCalledWith(
        'run-live001',
        expect.any(Function),
        expect.any(Object),
      );
      // initial load + success reload
      expect(listProjectFiles.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('loads live artifacts tab and creates a live artifact', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    let items: Array<Record<string, unknown>> = [];
    listLiveArtifacts.mockImplementation(async () => ({ ok: true, data: items }));
    createLiveArtifact.mockImplementation(async (input: {
      projectId: string;
      name: string;
      sourceTemplate?: string;
      inputs?: Record<string, unknown>;
    }) => {
      const row = {
        id: 'live-1',
        projectId: input.projectId,
        name: input.name,
        content: '<h1>Hello</h1><p>Live artifact</p>',
        refreshCount: 0,
        sidecarPath: '.neos/live/live-1.json',
        createdAt: 't',
        updatedAt: 't',
      };
      items = [row];
      return { ok: true, data: row };
    });

    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-live'));
    await waitFor(() => {
      expect(listLiveArtifacts).toHaveBeenCalledWith('proj-1');
      expect(screen.getByTestId('project-live')).toBeInTheDocument();
    });
    expect(screen.getByText('project.liveEmpty')).toBeInTheDocument();

    await user.click(screen.getByTestId('live-create'));
    await waitFor(() => {
      expect(createLiveArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-1',
          name: 'Live card',
          sourceTemplate: expect.stringContaining('{{title}}'),
        }),
      );
      expect(screen.getByTestId('live-item-live-1')).toBeInTheDocument();
    });
    // select shows preview
    await user.click(screen.getByText('Live card'));
    await waitFor(() => expect(screen.getByTestId('live-preview')).toBeInTheDocument());
  });

  it('rejects invalid live name and invalid inputs JSON', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-live'));
    await waitFor(() => expect(screen.getByTestId('project-live')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('live-name'), { target: { value: `bad${'\0'}name` } });
    await user.click(screen.getByTestId('live-create'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('project.liveInvalidName'));
    expect(createLiveArtifact).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('live-name'), { target: { value: 'Ok Live' } });
    fireEvent.change(screen.getByTestId('live-inputs'), { target: { value: '{not-json' } });
    await user.click(screen.getByTestId('live-create'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('project.liveInvalidInputs'));
    expect(createLiveArtifact).not.toHaveBeenCalled();
  });

  it('shows live load error and create failure', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listLiveArtifacts.mockResolvedValue({ ok: false, error: `live${'\n'}load${'\0'}` });
    createLiveArtifact.mockResolvedValue({ ok: false, error: 'create denied' });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-live'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('live load');
    });

    // recover list so create can be attempted
    listLiveArtifacts.mockResolvedValue({ ok: true, data: [] });
    fireEvent.change(screen.getByTestId('live-name'), { target: { value: 'X' } });
    // clear error path still via create fail
    await user.click(screen.getByTestId('live-create'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('create denied'));
  });

  it('shows live load error when list throws', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listLiveArtifacts.mockRejectedValue(new Error(`boom${'\n'}list`));
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-live'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom list'));
  });

  it('refreshes and deletes a live artifact', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    const row = {
      id: 'live-2',
      projectId: 'proj-1',
      name: 'Card',
      content: '<p>v1</p>',
      refreshCount: 1,
      createdAt: 't',
      updatedAt: 't',
    };
    let items = [row];
    listLiveArtifacts.mockImplementation(async () => ({ ok: true, data: items }));
    refreshLiveArtifact.mockImplementation(async () => {
      items = [{ ...row, content: '<p>v2</p>', refreshCount: 2 }];
      return { ok: true, data: { artifact: items[0], refresh: { id: 'r1' } } };
    });
    deleteLiveArtifact.mockImplementation(async () => {
      items = [];
      return { ok: true, data: null };
    });

    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-live'));
    await waitFor(() => expect(screen.getByTestId('live-item-live-2')).toBeInTheDocument());

    await user.click(screen.getByText('project.liveRefresh'));
    await waitFor(() => {
      expect(refreshLiveArtifact).toHaveBeenCalledWith('live-2', 'proj-1');
      expect(screen.getByText(/refreshes: 2/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'common.delete' }));
    await waitFor(() => {
      expect(deleteLiveArtifact).toHaveBeenCalledWith('live-2', 'proj-1');
      expect(screen.getByText('project.liveEmpty')).toBeInTheDocument();
    });
  });

  it('shows live refresh and delete errors', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listLiveArtifacts.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'live-3',
          projectId: 'proj-1',
          name: 'Z',
          content: '<p>z</p>',
          refreshCount: 0,
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    });
    refreshLiveArtifact.mockResolvedValue({ ok: false, error: 'refresh no' });
    deleteLiveArtifact.mockResolvedValue({ ok: false, error: 'delete no' });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-live'));
    await waitFor(() => expect(screen.getByTestId('live-item-live-3')).toBeInTheDocument());

    await user.click(screen.getByText('project.liveRefresh'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('refresh no'));

    await user.click(screen.getByRole('button', { name: 'common.delete' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('delete no'));
  });

  it('shows live create throw error', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listLiveArtifacts.mockResolvedValue({ ok: true, data: [] });
    createLiveArtifact.mockRejectedValue(new Error(`create${'\0'}boom`));
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('side-tab-live'));
    await user.click(screen.getByTestId('live-create'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('createboom'));
  });

  it('applies project file SSE disk-changed and refreshes tree on file.created', async () => {
    let sseHandler:
      | ((ev: { type: string; path?: string }) => void)
      | undefined;
    streamProjectFileEvents.mockImplementation((_id: string, cb: typeof sseHandler) => {
      sseHandler = cb;
      return () => {};
    });
    mockLoadedProject();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await waitFor(() => expect(streamProjectFileEvents).toHaveBeenCalled());

    // Remote change for open file (clean buffer → adopt disk content)
    readProjectFile.mockResolvedValueOnce({
      ok: true,
      data: { path: 'index.html', content: '<html>remote</html>', hash: 'remote-hash' },
    });
    sseHandler?.({ type: 'file.changed', path: 'index.html' });
    await waitFor(() => {
      expect(readProjectFile).toHaveBeenCalledWith('proj-1', 'index.html');
    });
    await waitFor(() => {
      const ta = screen.getByLabelText('project.mode.code') as HTMLTextAreaElement;
      expect(ta.value).toContain('remote');
    });

    // file.created refreshes list
    listProjectFiles.mockClear();
    listProjectFiles.mockResolvedValueOnce({
      ok: true,
      data: [
        { path: 'index.html', name: 'index.html', type: 'file', isEntry: true },
        { path: 'new.html', name: 'new.html', type: 'file', isEntry: false },
      ],
    });
    readProjectFile.mockResolvedValueOnce({
      ok: true,
      data: { path: 'index.html', content: '<html>remote</html>', hash: 'remote-hash' },
    });
    sseHandler?.({ type: 'file.created', path: 'index.html' });
    await waitFor(() => {
      expect(listProjectFiles).toHaveBeenCalled();
    });
  });

  it('ignores SSE for other paths and read failures', async () => {
    let sseHandler:
      | ((ev: { type: string; path?: string }) => void)
      | undefined;
    streamProjectFileEvents.mockImplementation((_id: string, cb: typeof sseHandler) => {
      sseHandler = cb;
      return () => {};
    });
    mockLoadedProject();
    renderWorkspace();
    await waitFor(() => expect(streamProjectFileEvents).toHaveBeenCalled());

    const readsBefore = readProjectFile.mock.calls.length;
    sseHandler?.({ type: 'file.changed', path: 'other.html' });
    sseHandler?.({ type: 'file.deleted', path: 'index.html' });
    sseHandler?.({ type: 'file.changed', path: '' });
    // only other.html ignored; deleted ignored; empty path ignored
    expect(readProjectFile.mock.calls.length).toBe(readsBefore);

    readProjectFile.mockResolvedValueOnce({ ok: false, error: 'gone' });
    sseHandler?.({ type: 'file.changed', path: 'index.html' });
    await waitFor(() => {
      expect(readProjectFile).toHaveBeenCalledWith('proj-1', 'index.html');
    });
  });

  it('opens .univer.json in SheetsPane instead of DesignEditor', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listProjectFiles.mockResolvedValue({
      ok: true,
      data: [
        { path: 'index.html', name: 'index.html', type: 'file', isEntry: true },
        { path: 'budget.univer.json', name: 'budget.univer.json', type: 'file', isEntry: false },
      ],
    });
    readProjectFile.mockImplementation(async (_id: string, path: string) => ({
      ok: true,
      data: {
        path,
        content:
          path === 'budget.univer.json'
            ? '{"id":"wb1","name":"Workbook","appVersion":"1.0.2","sheets":{"sheet-01":{"id":"sheet-01"}}}'
            : '<html>hi</html>',
        hash: path === 'budget.univer.json' ? 'sheet-hash' : 'abc',
      },
    }));
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /budget\.univer\.json/i }));
    await waitFor(() => {
      expect(screen.getByTestId('sheets-pane')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('design-editor')).not.toBeInTheDocument();
  });

  it('keeps DesignEditor for .html and .csv files', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listProjectFiles.mockResolvedValue({
      ok: true,
      data: [
        { path: 'index.html', name: 'index.html', type: 'file', isEntry: true },
        { path: 'data.csv', name: 'data.csv', type: 'file', isEntry: false },
      ],
    });
    readProjectFile.mockImplementation(async (_id: string, path: string) => ({
      ok: true,
      data: {
        path,
        content: path === 'data.csv' ? 'a,b\n1,2\n' : '<html>hi</html>',
        hash: path === 'data.csv' ? 'csv-hash' : 'abc',
      },
    }));
    renderWorkspace();
    await waitFor(() => expect(screen.getByTestId('design-editor')).toBeInTheDocument());
    expect(screen.queryByTestId('sheets-pane')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /data\.csv/i }));
    await waitFor(() => {
      expect(readProjectFile).toHaveBeenCalledWith('proj-1', 'data.csv');
    });
    await waitFor(() => expect(screen.getByTestId('design-editor')).toBeInTheDocument());
    expect(screen.queryByTestId('sheets-pane')).not.toBeInTheDocument();
  });

  it('context Promote confirm appends manual text', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [userDesignSystem()] });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await openContext(user);
    await waitFor(() => {
      expect(screen.getByText(/## Never/)).toBeInTheDocument();
    });
    const context = screen.getByTestId('project-context');
    await user.type(within(context).getByTestId('ds-promote-text'), 'keep the focus ring');
    await user.click(within(context).getByTestId('ds-promote'));
    expect(window.confirm).toHaveBeenCalledWith('designSystems.promoteConfirm');
    await waitFor(() => {
      expect(appendDesignSystemRules).toHaveBeenCalledTimes(1);
    });
    const payload = appendDesignSystemRules.mock.calls[0][1] as Record<string, unknown>;
    expect(appendDesignSystemRules).toHaveBeenCalledWith(
      'ds1',
      expect.objectContaining({ text: 'keep the focus ring', source: 'manual' }),
    );
    expect(payload).not.toHaveProperty('commentId');
    expect(getDesignSystemRules.mock.calls.length).toBeGreaterThan(1);
    expect(pruneDesignSystemRules).not.toHaveBeenCalled();
  });

  it('cancelling Promote confirm does not append', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [userDesignSystem()] });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await openContext(user);
    await user.type(screen.getByTestId('ds-promote-text'), 'keep the focus ring');
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(screen.getByTestId('ds-promote'));
    expect(window.confirm).toHaveBeenCalledWith('designSystems.promoteConfirm');
    expect(appendDesignSystemRules).not.toHaveBeenCalled();
  });

  it('501-char Context text is blocked in the client', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [userDesignSystem()] });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await openContext(user);
    const field = screen.getByTestId('ds-promote-text');
    const promote = screen.getByTestId('ds-promote');
    expect(promote).toBeDisabled();

    fireEvent.change(field, { target: { value: 'x'.repeat(501) } });
    expect(promote).toBeDisabled();
    await user.click(promote);
    expect(appendDesignSystemRules).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '   ' } });
    expect(promote).toBeDisabled();
    await user.click(promote);
    expect(appendDesignSystemRules).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: `keep${'\0'}me` } });
    expect(promote).toBeDisabled();
    await user.click(promote);
    expect(appendDesignSystemRules).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: 'x'.repeat(500) } });
    expect(promote).not.toBeDisabled();
    await user.click(promote);
    await waitFor(() => {
      expect(appendDesignSystemRules).toHaveBeenCalledTimes(1);
    });
    expect((appendDesignSystemRules.mock.calls[0][1] as { text: string }).text).toHaveLength(500);
  });

  it('preview-comment row Promote sends source preview-comment and commentId', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [userDesignSystem()] });
    listProjectPreviewComments.mockResolvedValue({
      ok: true,
      data: [{
        id: 'c1',
        filePath: 'index.html',
        selector: '#hero',
        body: 'tighten spacing',
        createdAt: 't',
      }],
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await openComments(user);
    await waitFor(() => expect(screen.getByTestId('comment-c1')).toBeInTheDocument());
    await user.click(
      within(screen.getByTestId('comment-c1')).getByTestId('comment-promote-c1'),
    );
    expect(window.confirm).toHaveBeenCalledWith('designSystems.promoteConfirm');
    await waitFor(() => {
      expect(appendDesignSystemRules).toHaveBeenCalledWith('ds1', {
        text: 'tighten spacing',
        source: 'preview-comment',
        commentId: 'c1',
      });
    });
    expect(deleteProjectPreviewComment).not.toHaveBeenCalled();
    await user.click(within(screen.getByTestId('comment-c1')).getByRole('button', { name: 'common.delete' }));
    await waitFor(() => {
      expect(deleteProjectPreviewComment).toHaveBeenCalledWith('proj-1', 'c1');
    });
  });

  it('preview-comment body longer than 500 is blocked without fetch', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [userDesignSystem()] });
    listProjectPreviewComments.mockResolvedValue({
      ok: true,
      data: [{
        id: 'c1',
        filePath: 'index.html',
        selector: '#hero',
        body: 'y'.repeat(501),
        createdAt: 't',
      }],
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await openComments(user);
    const promote = within(screen.getByTestId('comment-c1')).getByTestId('comment-promote-c1');
    expect(promote).toBeDisabled();
    await user.click(promote);
    expect(appendDesignSystemRules).not.toHaveBeenCalled();
  });

  it('Promote is disabled when no designSystemId is bound', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listProjectPreviewComments.mockResolvedValue({
      ok: true,
      data: [{
        id: 'c1',
        filePath: 'index.html',
        selector: '#hero',
        body: 'tighten spacing',
        createdAt: 't',
      }],
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await openContext(user);
    const contextPromote = within(screen.getByTestId('project-context')).getByTestId('ds-promote');
    expect(contextPromote).toBeDisabled();
    fireEvent.change(screen.getByTestId('ds-promote-text'), { target: { value: 'keep the focus ring' } });
    expect(contextPromote).toBeDisabled();
    await user.click(contextPromote);
    expect(appendDesignSystemRules).not.toHaveBeenCalled();

    await openComments(user);
    const commentPromote = within(screen.getByTestId('comment-c1')).getByTestId('comment-promote-c1');
    expect(commentPromote).toBeDisabled();
    await user.click(commentPromote);
    expect(appendDesignSystemRules).not.toHaveBeenCalled();
  });

  it('bundled design system Promote still calls API and surfaces 403', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [userDesignSystem({ name: 'neos-default', source: 'bundled' })],
    });
    appendDesignSystemRules.mockResolvedValue({
      ok: false,
      error: 'Bundled design systems are read-only',
    });
    listProjectPreviewComments.mockResolvedValue({
      ok: true,
      data: [{
        id: 'c1',
        filePath: 'index.html',
        selector: '#hero',
        body: 'tighten spacing',
        createdAt: 't',
      }],
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await openContext(user);
    await user.type(screen.getByTestId('ds-promote-text'), 'keep the focus ring');
    await user.click(screen.getByTestId('ds-promote'));
    await waitFor(() => {
      expect(appendDesignSystemRules).toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('Bundled design systems are read-only');
    });
    expect(document.body.textContent).not.toContain('\0');

    appendDesignSystemRules.mockClear();
    await openComments(user);
    await user.click(within(screen.getByTestId('comment-c1')).getByTestId('comment-promote-c1'));
    await waitFor(() => {
      expect(appendDesignSystemRules).toHaveBeenCalledWith('ds1', {
        text: 'tighten spacing',
        source: 'preview-comment',
        commentId: 'c1',
      });
      expect(screen.getByRole('alert')).toHaveTextContent('Bundled design systems are read-only');
    });
  });

  it('Context Promote from Design Editor selection uses source editor', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [userDesignSystem()] });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await openContext(user);
    expect(screen.getByTestId('ds-promote-selection')).toBeDisabled();

    await user.click(screen.getByTestId('mock-select'));
    const selectionPromote = screen.getByTestId('ds-promote-selection');
    expect(selectionPromote).not.toBeDisabled();
    await user.click(selectionPromote);
    await waitFor(() => {
      expect(appendDesignSystemRules).toHaveBeenCalledWith('ds1', {
        text: '<div id="hero">Hello</div>',
        source: 'editor',
      });
    });
    expect(appendDesignSystemRules.mock.calls[0][1]).not.toHaveProperty('commentId');

    appendDesignSystemRules.mockClear();
    await user.click(screen.getByTestId('mock-select-long'));
    expect(screen.getByTestId('ds-promote-selection')).toBeDisabled();
    await user.click(screen.getByTestId('ds-promote-selection'));
    expect(appendDesignSystemRules).not.toHaveBeenCalled();
  });

  it('append failure shows scrubbed error; success does not auto-run', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [userDesignSystem()] });
    appendDesignSystemRules.mockResolvedValue({
      ok: false,
      error: `disk${'\n'}full${'\0'}!`,
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await openContext(user);
    await user.type(screen.getByTestId('ds-promote-text'), 'keep the focus ring');
    await user.click(screen.getByTestId('ds-promote'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('disk full!');
    });
    expect(document.body.textContent).not.toContain('\0');
    expect(createProjectRun).not.toHaveBeenCalled();
  });

  it('ProjectWorkspace does not append RULES on run completion', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [userDesignSystem()] });
  it('renders variants toolbar in the editor column, not Context', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    const toolbar = screen.getByTestId('project-variants-toolbar');
    expect(toolbar).toBeInTheDocument();
    expect(
      within(screen.getByTestId('project-side-panel')).queryByTestId('project-variants-toolbar'),
    ).toBeNull();
    await user.click(screen.getByTestId('side-tab-context'));
    expect(screen.getByTestId('project-variants-toolbar')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('project-side-panel')).queryByTestId('project-variants-toolbar'),
    ).toBeNull();
    expect(screen.queryByTestId('variant-canvas')).toBeNull();
    expect(screen.queryByTestId('variant-split')).toBeNull();
    expect(screen.queryByRole('option', { name: 'designSystems.seedStarter' })).toBeNull();
  });

  it('disables Make variants when the current file is not HTML', async () => {
    const user = userEvent.setup();
    mockHtmlProject([{ path: 'styles.css', type: 'file' }], { entryFile: 'styles.css' });
    readProjectFile.mockImplementation(async (_id: string, path: string) => ({
      ok: true,
      data: { path, content: 'body { color: red; }', hash: 'css' },
    }));
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    const toolbar = screen.getByTestId('project-variants-toolbar');
    expect((screen.getByTestId('variant-seed') as HTMLSelectElement).value).toBe('current');
    const btn = screen.getByTestId('make-variants');
    expect(btn).toBeDisabled();
    expect(
      btn.getAttribute('title')
        ?? btn.getAttribute('aria-description')
        ?? toolbar.textContent
        ?? '',
    ).toContain('designSystems.variantsNeedHtml');
    await user.click(btn);
    expect(createProjectRun).not.toHaveBeenCalled();
  });

  it('enables Make variants for .html and .HTM current files', async () => {
    mockLoadedProject();
    const first = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.getByTestId('make-variants')).toBeEnabled();
    first.unmount();

    mockHtmlProject([{ path: 'page.HTM', type: 'file' }], { entryFile: 'page.HTM' });
    readProjectFile.mockImplementation(async (_id: string, path: string) => ({
      ok: true,
      data: { path, content: '<html>htm</html>', hash: 'htm' },
    }));
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.getByTestId('make-variants')).toBeEnabled();
  });

  it('disables when seed=live and the selected live artifact is not HTML', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    listLiveArtifacts.mockResolvedValue({
      ok: true,
      data: [{ id: 'live-plain', name: 'Note', content: 'hi', contentType: 'text/plain' }],
    });
    const first = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('variant-seed'), 'live');
    const liveSelect = screen.queryByTestId('variant-live-id');
    if (liveSelect) {
      await user.selectOptions(liveSelect, 'live-plain');
    }
    const btn = screen.getByTestId('make-variants');
    expect(btn).toBeDisabled();
    expect(
      btn.getAttribute('title')
        ?? btn.getAttribute('aria-description')
        ?? screen.getByTestId('project-variants-toolbar').textContent
        ?? '',
    ).toContain('designSystems.variantsNeedHtml');
    first.unmount();

    listLiveArtifacts.mockResolvedValue({
      ok: true,
      data: [{ id: 'live-html', name: 'Hero', content: '<section>ok</section>' }],
    });
    const missingType = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('variant-seed'), 'live');
    expect(screen.getByTestId('make-variants')).toBeDisabled();
    missingType.unmount();

    listLiveArtifacts.mockResolvedValue({
      ok: true,
      data: [{
        id: 'live-html',
        name: 'Hero',
        content: '<section>ok</section>',
        contentType: 'text/html',
      }],
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('variant-seed'), 'live');
    expect(screen.getByTestId('make-variants')).toBeEnabled();
  });

  it('hides components seed when no designSystemId; shows it when bound', async () => {
    mockLoadedProject();
    const first = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'designSystems.seedComponents' })).toBeNull();
    expect(getDesignSystemComponents).not.toHaveBeenCalled();
    first.unmount();

    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [boundDesignSystemRow(true)],
    });
    const second = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'designSystems.seedComponents' })).toBeInTheDocument();
    expect(getDesignSystemComponents).not.toHaveBeenCalled();
    second.unmount();

    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [boundDesignSystemRow(false)],
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'designSystems.seedComponents' })).toBeNull();
  });

  it('count select defaults to 3 and accepts 2/4', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    await startSucceededRun();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    const count = screen.getByTestId('variant-count') as HTMLSelectElement;
    expect(count).toHaveAccessibleName('designSystems.variantsCount');
    expect(count.value).toBe('3');
    expect([...count.options].map((o) => o.value)).toEqual(['2', '3', '4']);
    await user.selectOptions(count, '2');
    expect(count.value).toBe('2');
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(createProjectRun).toHaveBeenCalled());
    const prompt = String(createProjectRun.mock.calls[0]![0].prompt);
    expect(prompt).toContain('write 2 clickable');
    expect(prompt).toContain('- index.variant-a.html');
    expect(prompt).toContain('- index.variant-b.html');
    expect(prompt).not.toContain('index.variant-c.html');
  });

  it('current HTML file: patch editContext, English suffix, default N=3 paths', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    await startSucceededRun();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('mock-select'));
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(createProjectRun).toHaveBeenCalledTimes(1));
    const payload = createProjectRun.mock.calls[0]![0] as {
      projectId: string;
      dryRun: boolean;
      prompt: string;
      editContext: { filePath: string; mode: string; snippet: string };
    };
    expect(payload).toEqual(
      expect.objectContaining({
        projectId: 'proj-1',
        dryRun: true,
        prompt: expect.stringContaining('## Variant task'),
        editContext: {
          filePath: 'index.html',
          mode: 'patch',
          snippet: '<html>hi</html>',
        },
      }),
    );
    expect(payload.prompt).toContain('write 3 clickable');
    expect(payload.prompt).toContain('- index.variant-a.html');
    expect(payload.prompt).toContain('- index.variant-b.html');
    expect(payload.prompt).toContain('- index.variant-c.html');
    expect(payload.prompt).toContain('### Seed HTML');
    expect(payload.prompt).toContain('<html>hi</html>');
    expect(payload.prompt).toContain('Do not use replace-file');
    expect(payload.editContext.mode).not.toBe('replace-selection');
    expect(payload.editContext.mode).not.toBe('replace-file');
    expect(getDesignSystemComponents).not.toHaveBeenCalled();
  });

  it('current HTML file: editContext snippet is capped at 64 KiB', async () => {
    const user = userEvent.setup();
    const seed = `<html>${'A'.repeat(64 * 1024)}</html>`;
    mockLoadedProject();
    readProjectFile.mockImplementation(async (_id: string, path: string) => ({
      ok: true,
      data: { path, content: seed, hash: 'big' },
    }));
    await startSucceededRun();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(createProjectRun).toHaveBeenCalled());
    const payload = createProjectRun.mock.calls[0]![0] as {
      editContext: { mode: string; snippet: string };
      prompt: string;
    };
    expect(payload.editContext.mode).toBe('patch');
    expect(payload.editContext.snippet.length).toBe(64 * 1024);
    expect(payload.editContext.snippet.length).toBeGreaterThan(8_000);
    expect(payload.prompt).toContain('…[seed truncated]');
  });

  it('collision uses -2 in the suffix list', async () => {
    const user = userEvent.setup();
    mockHtmlProject([
      { path: 'index.html', type: 'file' },
      { path: 'index.variant-a.html', type: 'file' },
      { path: 'about.html', type: 'file' },
    ]);
    await startSucceededRun();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(createProjectRun).toHaveBeenCalled());
    const prompt = String(createProjectRun.mock.calls[0]![0].prompt);
    const bullets = prompt.split('\n').filter((line: string) => line.startsWith('- '));
    expect(bullets).toEqual([
      '- index.variant-a-2.html',
      '- index.variant-b.html',
      '- index.variant-c.html',
    ]);
    expect(prompt).not.toMatch(/^- index\.variant-a\.html$/m);
    expect(createProjectRun.mock.calls[0]![0].editContext.filePath).toBe('index.html');
  });

  it('fresh listProjectFiles is used for collisions when files state is stale', async () => {
    const user = userEvent.setup();
    mockHtmlProject([{ path: 'index.html', type: 'file' }]);
    let listCalls = 0;
    listProjectFiles.mockImplementation(async () => {
      listCalls += 1;
      if (listCalls === 1) {
        return {
          ok: true,
          data: [{ path: 'index.html', name: 'index.html', type: 'file', isEntry: true }],
        };
      }
      return {
        ok: true,
        data: [
          { path: 'index.html', name: 'index.html', type: 'file', isEntry: true },
          { path: 'index.variant-a.html', name: 'index.variant-a.html', type: 'file', isEntry: false },
        ],
      };
    });
    await startSucceededRun();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(createProjectRun).toHaveBeenCalled());
    const prompt = String(createProjectRun.mock.calls[0]![0].prompt);
    expect(prompt).toContain('- index.variant-a-2.html');
    expect(prompt).not.toMatch(/^- index\.variant-a\.html$/m);
  });

  it('components.html seed omits editContext and fetches GET components', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    await startSucceededRun();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('variant-seed'), 'components');
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(createProjectRun).toHaveBeenCalled());
    expect(getDesignSystemComponents).toHaveBeenCalledWith('ds1');
    const payload = createProjectRun.mock.calls[0]![0] as {
      editContext?: unknown;
      prompt: string;
    };
    expect(payload.editContext).toBeUndefined();
    expect(payload.prompt).toContain('### Seed HTML');
    expect(payload.prompt).toContain('<button class="ds-btn">Ok</button>');
    expect(payload.prompt).toContain('components.variant-a.html');
  });

  it('components GET 404 does not start a run', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    getDesignSystemComponents.mockResolvedValue({ ok: false, error: 'Not found' });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('variant-seed'), 'components');
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(getDesignSystemComponents).toHaveBeenCalledWith('ds1'));
    expect(createProjectRun).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Not found/i);
    expect(alert.textContent).not.toMatch(/\/Users\/|~\/\.config|design-systems\/ds1/);
  });

  it('live HTML seed omits editContext, slices 64 KiB, does not fetch components', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    const liveBody = '<section>live</section>';
    listLiveArtifacts.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'live-1',
          name: 'Hero Card!',
          content: liveBody,
          contentType: 'text/html',
        },
      ],
    });
    await startSucceededRun();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('variant-seed'), 'live');
    const liveSelect = screen.queryByTestId('variant-live-id');
    if (liveSelect) {
      await user.selectOptions(liveSelect, 'live-1');
    }
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(createProjectRun).toHaveBeenCalled());
    const payload = createProjectRun.mock.calls[0]![0] as {
      editContext?: unknown;
      prompt: string;
    };
    expect(payload.editContext).toBeUndefined();
    expect(getDesignSystemComponents).not.toHaveBeenCalled();
    expect(payload.prompt).toContain('HeroCard.variant-a.html');
    expect(payload.prompt).toContain(liveBody);
  });

  it('regular chat does not inject components.html or the variant suffix', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    createProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-abcdef01', status: 'running' },
    });
    streamProjectRunEvents.mockImplementation((_runId, onEvent, opts) => {
      queueMicrotask(() => {
        onEvent({
          type: 'run.stdout',
          id: 'ev1',
          ts: 't',
          data: { chunk: 'hello from dry-run' },
        });
        onEvent({ type: 'run.started', id: 'ev1', ts: 't' });
        opts?.onDone?.();
      });
      return () => {};
    });
    getProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-abcdef01', status: 'succeeded', error: null },
    });

    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.type(screen.getByLabelText('project.chat'), 'Improve the hero');
    await user.click(screen.getByRole('button', { name: 'project.chatSend' }));
    await waitFor(() => {
      expect(createProjectRun).toHaveBeenCalled();
      expect(getProjectRun).toHaveBeenCalledWith('run-abcdef01');
    });
    expect(appendDesignSystemRules).not.toHaveBeenCalled();
    await waitFor(() => expect(createProjectRun).toHaveBeenCalled());
    const payload = createProjectRun.mock.calls[0]![0] as {
      prompt: string;
      editContext: { mode: string; snippet: string };
    };
    expect(payload.prompt).toBe('Improve the hero');
    expect(payload.prompt).not.toContain('## Variant task');
    expect(payload.prompt).not.toContain('### Seed HTML');
    expect(payload.editContext.mode).toBe('patch');
    expect(payload.editContext.snippet.length).toBeLessThanOrEqual(8_000);
    expect(getDesignSystemComponents).not.toHaveBeenCalled();
  });

  it('uses selected chat agent (live, not dryRun)', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    await startSucceededRun();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('project.chatAgent'), 'cli-claude');
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(createProjectRun).toHaveBeenCalled());
    expect(createProjectRun.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        agentId: 'cli-claude',
        dryRun: false,
      }),
    );
  });

  it('after succeeded, Open variant buttons appear for files that exist, and click opens the buffer', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    const initialFiles = [
      { path: 'index.html', name: 'index.html', type: 'file' as const, isEntry: true },
      { path: 'about.html', name: 'about.html', type: 'file' as const, isEntry: false },
    ];
    const afterFiles = [
      ...initialFiles,
      { path: 'index.variant-a.html', name: 'index.variant-a.html', type: 'file' as const, isEntry: false },
      { path: 'index.variant-b.html', name: 'index.variant-b.html', type: 'file' as const, isEntry: false },
      { path: 'index.variant-c.html', name: 'index.variant-c.html', type: 'file' as const, isEntry: false },
    ];
    listProjectFiles.mockImplementation(async () => {
      if (createProjectRun.mock.calls.length === 0) {
        return { ok: true, data: initialFiles };
      }
      return { ok: true, data: afterFiles };
    });
    readProjectFile.mockImplementation(async (_id: string, path: string) => ({
      ok: true,
      data: {
        path,
        content: path === 'index.variant-a.html' ? '<html>A</html>' : '<html>hi</html>',
        hash: path,
      },
    }));
    await startSucceededRun();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(screen.getByTestId('open-variant-a')).toBeInTheDocument());
    expect(screen.getByTestId('open-variant-b')).toBeInTheDocument();
    expect(screen.getByTestId('open-variant-c')).toBeInTheDocument();
    expect(screen.getByTestId('open-variant-a')).toHaveAccessibleName(/designSystems\.openVariant/);
    expect(
      within(screen.getByTestId('project-side-panel')).getByTestId('open-variant-a'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('project-variants-toolbar')).queryByTestId('open-variant-a'),
    ).toBeNull();
    expect(screen.queryByTestId('variant-canvas')).toBeNull();
    expect(screen.queryByTestId('variant-split')).toBeNull();
    await user.click(screen.getByTestId('open-variant-a'));
    await waitFor(() => {
      expect(readProjectFile).toHaveBeenCalledWith('proj-1', 'index.variant-a.html');
    });
    await waitFor(() => {
      expect((screen.getByLabelText('project.mode.code') as HTMLTextAreaElement).value).toContain(
        '<html>A</html>',
      );
    });
  });

  it('omits Open buttons for paths the agent did not write', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    await startSucceededRun();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(createProjectRun).toHaveBeenCalled());
    await waitFor(() => expect(getProjectRun).toHaveBeenCalled());
    expect(screen.queryByTestId('open-variant-a')).toBeNull();
  });

  it('does not show Open controls on failed/canceled runs', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    createProjectRun.mockResolvedValue({ ok: true, data: { id: 'run-fail001', status: 'running' } });
    streamProjectRunEvents.mockImplementation((_id, onEvent, opts) => {
      queueMicrotask(() => {
        onEvent({ type: 'run.started', id: 'ev1', ts: 't' });
        onEvent({ type: 'run.failed', id: 'ev2', ts: 't2' });
        opts?.onDone?.();
      });
      return () => {};
    });
    getProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-fail001', status: 'failed', error: 'boom' },
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(getProjectRun).toHaveBeenCalled());
    expect(screen.queryByTestId('open-variant-a')).toBeNull();
    expect(screen.queryByTestId('open-variant-b')).toBeNull();
  });

  it('pin-starter lives in the variants toolbar, not Context', async () => {
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    const pin = screen.getByTestId('pin-starter');
    expect(pin).toBeInTheDocument();
    expect(pin).toHaveAccessibleName('designSystems.pinStarter');
    expect(within(screen.getByTestId('project-variants-toolbar')).getByTestId('pin-starter')).toBeInTheDocument();
    expect(within(screen.getByTestId('project-side-panel')).queryByTestId('pin-starter')).toBeNull();
  });

  it('enables pin-starter for current html/css when designSystemId is bound', async () => {
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    const html = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.getByTestId('pin-starter')).toBeEnabled();
    html.unmount();

    mockHtmlProject([{ path: 'styles.css', type: 'file' }], {
      designSystemId: 'ds1',
      entryFile: 'styles.css',
    });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    readProjectFile.mockImplementation(async (_id: string, path: string) => ({
      ok: true,
      data: { path, content: 'body{}', hash: 'css' },
    }));
    const css = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.getByTestId('pin-starter')).toBeEnabled();
    css.unmount();

    mockHtmlProject([{ path: 'notes.txt', type: 'file' }], {
      designSystemId: 'ds1',
      entryFile: 'notes.txt',
    });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    readProjectFile.mockImplementation(async (_id: string, path: string) => ({
      ok: true,
      data: { path, content: 'hi', hash: 'txt' },
    }));
    const txt = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.getByTestId('pin-starter')).toBeDisabled();
    txt.unmount();

    mockHtmlProject([{ path: 'page.htm', type: 'file' }], {
      designSystemId: 'ds1',
      entryFile: 'page.htm',
    });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    readProjectFile.mockImplementation(async (_id: string, path: string) => ({
      ok: true,
      data: { path, content: '<p/>', hash: 'htm' },
    }));
    const htm = renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.getByTestId('pin-starter')).toBeDisabled();
    htm.unmount();

    mockLoadedProject();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    expect(screen.getByTestId('pin-starter')).toBeDisabled();
  });

  it('pin current src/hero.html POSTs pinDesignSystemStarter with basename, not PUT', async () => {
    const user = userEvent.setup();
    mockHtmlProject([{ path: 'src/hero.html', type: 'file' }], {
      designSystemId: 'ds1',
      entryFile: 'src/hero.html',
    });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('pin-starter'));
    await waitFor(() => expect(pinDesignSystemStarter).toHaveBeenCalledTimes(1));
    expect(pinDesignSystemStarter).toHaveBeenCalledWith('ds1', {
      from: 'projectFile',
      projectId: 'proj-1',
      path: 'src/hero.html',
      name: 'hero.html',
    });
    expect(saveDesignSystemStarter).not.toHaveBeenCalled();
  });

  it('pin 409 surfaces the API error and does not PUT to overwrite', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    pinDesignSystemStarter.mockResolvedValue({ ok: false, error: 'Starter already exists' });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await user.click(screen.getByTestId('pin-starter'));
    await waitFor(() => expect(pinDesignSystemStarter).toHaveBeenCalled());
    expect(saveDesignSystemStarter).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Starter already exists/i);
  });

  it('seed picker lists HTML starters only, not css', async () => {
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    listDesignSystemStarters.mockResolvedValue({
      ok: true,
      data: [
        { name: 'hero.html', bytes: 12, updatedAt: 't' },
        { name: 'theme.css', bytes: 8, updatedAt: 't' },
      ],
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await waitFor(() => expect(listDesignSystemStarters).toHaveBeenCalledWith('ds1'));
    const starterSelect = screen.getByTestId('variant-seed-starter') as HTMLSelectElement;
    const values = [...starterSelect.options].map((o) => o.value);
    expect(values).toContain('hero.html');
    expect(values).not.toContain('theme.css');
    expect(screen.queryByRole('option', { name: 'theme.css' })).toBeNull();
  });

  it('HTML starter seed omits editContext and uses stem from hero', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    listDesignSystemStarters.mockResolvedValue({
      ok: true,
      data: [
        { name: 'hero.html', bytes: 12, updatedAt: 't' },
        { name: 'theme.css', bytes: 8, updatedAt: 't' },
      ],
    });
    getDesignSystemStarter.mockResolvedValue({
      ok: true,
      data: { content: '<section>hero</section>' },
    });
    await startSucceededRun();
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await waitFor(() => expect(listDesignSystemStarters).toHaveBeenCalledWith('ds1'));
    await user.selectOptions(screen.getByTestId('variant-seed'), 'starter');
    const starterSelect = screen.getByTestId('variant-seed-starter');
    await user.selectOptions(starterSelect, 'hero.html');
    expect(screen.getByTestId('make-variants')).toBeEnabled();
    await user.click(screen.getByTestId('make-variants'));
    await waitFor(() => expect(createProjectRun).toHaveBeenCalled());
    expect(getDesignSystemStarter).toHaveBeenCalledWith('ds1', 'hero.html');
    const payload = createProjectRun.mock.calls[0]![0] as {
      editContext?: unknown;
      prompt: string;
    };
    expect(payload.editContext).toBeUndefined();
    expect(payload.prompt).toContain('hero.variant-a.html');
    expect(payload.prompt).toContain('<section>hero</section>');
  });

  it('clone-starter GETs the starter then writeProjectFile with basename only', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    listDesignSystemStarters.mockResolvedValue({
      ok: true,
      data: [
        { name: 'hero.html', bytes: 12, updatedAt: 't' },
        { name: 'theme.css', bytes: 8, updatedAt: 't' },
      ],
    });
    getDesignSystemStarter.mockResolvedValue({
      ok: true,
      data: { content: '<section>hero</section>' },
    });
    writeProjectFile.mockResolvedValue({
      ok: true,
      data: { path: 'hero.html', hash: 'h', bytes: 12, created: true },
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    await waitFor(() => expect(listDesignSystemStarters).toHaveBeenCalledWith('ds1'));
    await user.selectOptions(screen.getByTestId('variant-seed'), 'starter');
    await user.selectOptions(screen.getByTestId('variant-seed-starter'), 'hero.html');
    await user.click(screen.getByTestId('clone-starter'));
    await waitFor(() => expect(writeProjectFile).toHaveBeenCalled());
    expect(getDesignSystemStarter).toHaveBeenCalledWith('ds1', 'hero.html');
    expect(writeProjectFile).toHaveBeenCalledWith('proj-1', 'hero.html', '<section>hero</section>');
    const paths = writeProjectFile.mock.calls.map((c) => c[1]);
    expect(paths).not.toContain('starters/hero.html');
    expect(paths).not.toContain('src/hero.html');
  });

  it('regular chat still does not fetch starters or components', async () => {
    const user = userEvent.setup();
    mockLoadedProject({ designSystemId: 'ds1' });
    listDesignSystems.mockResolvedValue({ ok: true, data: [boundDesignSystemRow(true)] });
    listDesignSystemStarters.mockResolvedValue({
      ok: true,
      data: [{ name: 'hero.html', bytes: 12, updatedAt: 't' }],
    });
    createProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-abcdef01', status: 'running' },
    });
    streamProjectRunEvents.mockImplementation((_runId, onEvent, opts) => {
      queueMicrotask(() => {
        onEvent({ type: 'run.started', id: 'ev1', ts: 't' });
        opts?.onDone?.();
      });
      return () => {};
    });
    getProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-abcdef01', status: 'succeeded', error: null },
    });
    renderWorkspace();
    await waitFor(() => expect(screen.getByText('Demo')).toBeInTheDocument());
    getDesignSystemStarter.mockClear();
    getDesignSystemComponents.mockClear();
    await user.type(screen.getByLabelText('project.chat'), 'Improve the hero');
    await user.click(screen.getByRole('button', { name: 'project.chatSend' }));
    await waitFor(() => expect(createProjectRun).toHaveBeenCalled());
    expect(getDesignSystemStarter).not.toHaveBeenCalled();
    expect(getDesignSystemComponents).not.toHaveBeenCalled();
    expect(String(createProjectRun.mock.calls[0]![0].prompt)).toBe('Improve the hero');
  });

});
