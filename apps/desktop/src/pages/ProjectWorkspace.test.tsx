import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const getProject = vi.fn();
const listProjectFiles = vi.fn();
const readProjectFile = vi.fn();
const writeProjectFile = vi.fn();

const client = {
  getProject,
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
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
    t: (key: string) => key,
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

describe('ProjectWorkspace', () => {
  beforeEach(() => {
    getProject.mockReset();
    listProjectFiles.mockReset();
    readProjectFile.mockReset();
    writeProjectFile.mockReset();
  });

  it('loads project, shows files, saves dirty code via DesignEditor', async () => {
    const user = userEvent.setup();
    getProject.mockResolvedValue({
      ok: true,
      data: {
        id: 'proj-1',
        name: 'Demo',
        baseDir: '/tmp/demo',
        entryFile: 'index.html',
        designSystemId: null,
        meta: {},
        createdAt: 't',
        updatedAt: 't',
      },
    });
    listProjectFiles.mockResolvedValue({
      ok: true,
      data: [
        { path: 'index.html', name: 'index.html', type: 'file', isEntry: true },
        { path: 'css', name: 'css', type: 'directory' },
      ],
    });
    readProjectFile.mockResolvedValue({
      ok: true,
      data: { path: 'index.html', content: '<html>hi</html>', hash: 'abc' },
    });
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
});
