import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getProject = vi.fn();
const listProjectFiles = vi.fn();
const readProjectFile = vi.fn();
const writeProjectFile = vi.fn();
const listProjectPreviewComments = vi.fn();
const createProjectPreviewComment = vi.fn();
const deleteProjectPreviewComment = vi.fn();
const listProjectRevisions = vi.fn();
const restoreProjectRevision = vi.fn();
const listDesignSystems = vi.fn();
const getDesignSystemContent = vi.fn();
const getDesignSystemTokens = vi.fn();
const updateProject = vi.fn();
const createProjectRun = vi.fn();
const listProjectRunEvents = vi.fn();
const getProjectRun = vi.fn();

const client = {
  getProject,
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
  listProjectPreviewComments,
  createProjectPreviewComment,
  deleteProjectPreviewComment,
  listProjectRevisions,
  restoreProjectRevision,
  listDesignSystems,
  getDesignSystemContent,
  getDesignSystemTokens,
  updateProject,
  createProjectRun,
  listProjectRunEvents,
  getProjectRun,
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts?.selector ? `${key}:${opts.selector}` : key,
  }),
}));

// Lightweight mock — avoid requiring built dist for unit tests
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
    }) => {
      const dirty = props.buffer.local !== props.buffer.disk;
      return (
        <div data-testid="design-editor">
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

describe('ProjectWorkspace', () => {
  beforeEach(() => {
    getProject.mockReset();
    listProjectFiles.mockReset();
    readProjectFile.mockReset();
    writeProjectFile.mockReset();
    listProjectPreviewComments.mockReset().mockResolvedValue({ ok: true, data: [] });
    createProjectPreviewComment.mockReset();
    deleteProjectPreviewComment.mockReset();
    listProjectRevisions.mockReset().mockResolvedValue({ ok: true, data: [] });
    restoreProjectRevision.mockReset();
    listDesignSystems.mockReset().mockResolvedValue({ ok: true, data: [] });
    getDesignSystemContent.mockReset().mockResolvedValue({ ok: true, data: { content: '# DS' } });
    getDesignSystemTokens.mockReset().mockResolvedValue({ ok: true, data: { content: ':root{}' } });
    updateProject.mockReset();
    createProjectRun.mockReset();
    listProjectRunEvents.mockReset();
    getProjectRun.mockReset();
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

    const ta = screen.getByLabelText('project.mode.code') as HTMLTextAreaElement;
    await waitFor(() => expect(ta.value).toContain('hi'));
    fireEvent.change(ta, { target: { value: '<html>edited</html>' } });
    await waitFor(() => expect(screen.getByText('project.dirty')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(writeProjectFile).toHaveBeenCalledWith(
        'proj-1',
        'index.html',
        '<html>edited</html>',
        'user',
      );
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

  it('restores a revision and reloads file content', async () => {
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
    await user.click(screen.getByRole('button', { name: 'project.restore' }));
    await waitFor(() => {
      expect(restoreProjectRevision).toHaveBeenCalledWith('proj-1', 'rev-1');
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

  it('sends dry-run chat and polls run events until succeeded', async () => {
    const user = userEvent.setup();
    mockLoadedProject();
    createProjectRun.mockResolvedValue({
      ok: true,
      data: { id: 'run-abcdef01', status: 'running' },
    });
    listProjectRunEvents.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ev1',
          type: 'run.stdout',
          ts: 't',
          data: { chunk: 'hello from dry-run' },
        },
      ],
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
      expect(listProjectRunEvents).toHaveBeenCalled();
      expect(getProjectRun).toHaveBeenCalledWith('run-abcdef01');
      const log = screen.getByTestId('project-chat-log');
      expect(log.textContent).toMatch(/run\.stdout/);
      expect(log.textContent).toMatch(/succeeded/);
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
    listProjectRunEvents.mockResolvedValue({
      ok: true,
      data: [{ id: 'ev1', type: 'run.started', ts: 't' }],
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
      // initial load + success reload
      expect(listProjectFiles.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
