import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const listProjects = vi.fn();
const createProject = vi.fn();
const createImportToken = vi.fn();
const deleteProject = vi.fn();
const exportProjectZip = vi.fn();
const importProjectZip = vi.fn();
const navigate = vi.fn();

const client = {
  listProjects,
  createProject,
  createImportToken,
  deleteProject,
  exportProjectZip,
  importProjectZip,
};

const pickFolder = vi.fn();
const isTauri = vi.fn(() => false);

vi.mock('../lib/tauri.js', () => ({
  pickFolder: (...args: unknown[]) => pickFolder(...args),
  isTauri: () => isTauri(),
}));

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({ client }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('react-i18next', () => {
  // Stable t identity — avoids re-creating load() each render and wiping pageError
  const t = (key: string, opts?: { name?: string }) => {
    if (key === 'project.confirmDelete' && opts?.name) return `Delete ${opts.name}?`;
    return key;
  };
  return {
    useTranslation: () => ({ t }),
  };
});

const { Projects } = await import('./Projects.js');

const sample = [
  {
    id: 'p1',
    name: 'Landing',
    baseDir: '/tmp/landing',
    entryFile: 'index.html',
    designSystemId: null,
    meta: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <Projects />
    </MemoryRouter>,
  );
}

describe('Projects page', () => {
  beforeEach(() => {
    listProjects.mockReset();
    createProject.mockReset();
    createImportToken.mockReset();
    deleteProject.mockReset();
    exportProjectZip.mockReset();
    importProjectZip.mockReset();
    pickFolder.mockReset().mockResolvedValue(null);
    isTauri.mockReset().mockReturnValue(false);
    navigate.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows empty state', async () => {
    listProjects.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('project.empty')).toBeInTheDocument();
    });
  });

  it('lists projects and navigates to workspace', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: sample });
    renderPage();
    await waitFor(() => expect(screen.getByText('Landing')).toBeInTheDocument());
    await user.click(screen.getByText('Landing'));
    expect(navigate).toHaveBeenCalledWith('/projects/p1');
  });

  it('creates project and navigates', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: [] });
    createProject.mockResolvedValue({
      ok: true,
      data: { ...sample[0], id: 'new1', name: 'Hero' },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('project.empty')).toBeInTheDocument());
    await user.click(screen.getByText('project.new'));
    await user.type(screen.getByPlaceholderText('project.namePlaceholder'), 'Hero');
    await user.click(screen.getByText('common.create'));
    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Hero' }),
      );
      expect(createImportToken).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith('/projects/new1');
    });
  });

  it('creates project with baseDir after import token', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: [] });
    createImportToken.mockResolvedValue({
      ok: true,
      data: { token: 'tok-1', path: '/tmp/landing', expiresAt: '2099-01-01T00:00:00.000Z', expiresInMs: 300000 },
    });
    createProject.mockResolvedValue({
      ok: true,
      data: { ...sample[0], id: 'new2', name: 'Imported' },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('project.empty')).toBeInTheDocument());
    await user.click(screen.getByText('project.new'));
    await user.type(screen.getByPlaceholderText('project.namePlaceholder'), 'Imported');
    await user.type(screen.getByTestId('project-base-dir-input'), '/tmp/landing');
    await user.click(screen.getByText('common.create'));
    await waitFor(() => {
      expect(createImportToken).toHaveBeenCalledWith('/tmp/landing');
      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Imported',
          baseDir: '/tmp/landing',
          importToken: 'tok-1',
        }),
      );
      expect(navigate).toHaveBeenCalledWith('/projects/new2');
    });
  });

  it('browse folder uses pickFolder when available', async () => {
    const user = userEvent.setup();
    isTauri.mockReturnValue(true);
    pickFolder.mockResolvedValue('/Users/me/design');
    listProjects.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText('project.empty')).toBeInTheDocument());
    await user.click(screen.getByText('project.new'));
    await user.click(screen.getByTestId('project-browse-folder'));
    await waitFor(() => {
      expect(pickFolder).toHaveBeenCalled();
      expect((screen.getByTestId('project-base-dir-input') as HTMLInputElement).value).toBe(
        '/Users/me/design',
      );
    });
  });

  it('shows scrubbed list error', async () => {
    listProjects.mockResolvedValue({ ok: false, error: `fail${'\n'}ed${'\0'}` });
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText(/fail ed/).length).toBeGreaterThanOrEqual(1);
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('deletes project after confirm', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: sample });
    deleteProject.mockResolvedValue({ ok: true });
    renderPage();
    await waitFor(() => expect(screen.getByText('Landing')).toBeInTheDocument());
    await user.click(screen.getByText('common.delete'));
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith('p1'));
  });

  it('exports project zip via download', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: sample });
    const blob = new Blob(['PK'], { type: 'application/zip' });
    exportProjectZip.mockResolvedValue({ ok: true, blob });
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.fn();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: click });
      }
      return el;
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Landing')).toBeInTheDocument());
    await user.click(screen.getByTestId('project-export-p1'));
    await waitFor(() => expect(exportProjectZip).toHaveBeenCalledWith('p1'));
    expect(click).toHaveBeenCalled();
  });

  it('imports project zip from file input', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: [] });
    importProjectZip.mockResolvedValue({
      ok: true,
      data: { project: { ...sample[0], id: 'imp1', name: 'Imported' }, filesImported: 2 },
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('project-import-zip')).toBeInTheDocument());
    const input = screen.getByTestId('project-zip-input') as HTMLInputElement;
    const file = new File([new Uint8Array([0x50, 0x4b])], 'demo.zip', { type: 'application/zip' });
    await user.upload(input, file);
    await waitFor(() => {
      expect(importProjectZip).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith('/projects/imp1');
    });
  });

  it('shows scrubbed error when listProjects throws', async () => {
    listProjects.mockRejectedValue(new Error(`net${'\n'}down${'\0'}!`));
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('net down!');
    });
  });

  it('Escape closes create modal and clears search', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: sample });
    renderPage();
    await waitFor(() => expect(screen.getByText('Landing')).toBeInTheDocument());

    await user.click(screen.getByText('project.new'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const search = screen.getByLabelText('project.searchPlaceholder');
    await user.type(search, 'Landing');
    expect((search as HTMLInputElement).value).toBe('Landing');
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect((screen.getByLabelText('project.searchPlaceholder') as HTMLInputElement).value).toBe(
        '',
      );
    });
  });

  it('filters projects by search text', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({
      ok: true,
      data: [
        sample[0],
        {
          id: 'p2',
          name: 'Dashboard',
          baseDir: '/tmp/dash',
          entryFile: null,
          designSystemId: null,
          meta: {},
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-03T00:00:00.000Z',
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Landing')).toBeInTheDocument());
    await user.type(screen.getByLabelText('project.searchPlaceholder'), 'dash');
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Landing')).not.toBeInTheDocument();
  });

  it('rejects create name containing null bytes', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText('project.empty')).toBeInTheDocument());
    await user.click(screen.getByText('project.new'));

    const name = screen.getByPlaceholderText('project.namePlaceholder') as HTMLInputElement;
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(name, { target: { value: `bad${'\0'}name` } });
    await user.click(screen.getByText('common.create'));
    await waitFor(() => expect(screen.getByText('project.invalidName')).toBeInTheDocument());
    expect(createProject).not.toHaveBeenCalled();
  });

  it('shows create error when import token fails', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: [] });
    createImportToken.mockResolvedValue({ ok: false, error: 'token denied' });
    renderPage();
    await waitFor(() => expect(screen.getByText('project.empty')).toBeInTheDocument());
    await user.click(screen.getByText('project.new'));
    await user.type(screen.getByPlaceholderText('project.namePlaceholder'), 'Imported');
    await user.type(screen.getByTestId('project-base-dir-input'), '/tmp/landing');
    await user.click(screen.getByText('common.create'));
    await waitFor(() => expect(screen.getByText('token denied')).toBeInTheDocument());
    expect(createProject).not.toHaveBeenCalled();
  });

  it('shows create error when createProject fails or throws', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: [] });
    createProject
      .mockResolvedValueOnce({ ok: false, error: `create${'\n'}blocked` })
      .mockRejectedValueOnce(new Error(`boom${'\0'}create`));
    renderPage();
    await waitFor(() => expect(screen.getByText('project.empty')).toBeInTheDocument());
    await user.click(screen.getByText('project.new'));
    await user.type(screen.getByPlaceholderText('project.namePlaceholder'), 'Hero');
    await user.click(screen.getByText('common.create'));
    await waitFor(() => expect(screen.getByText('create blocked')).toBeInTheDocument());

    await user.click(screen.getByText('common.create'));
    await waitFor(() => expect(screen.getByText('boomcreate')).toBeInTheDocument());
  });

  it('shows pickFolder error', async () => {
    const user = userEvent.setup();
    isTauri.mockReturnValue(true);
    pickFolder.mockRejectedValue(new Error(`pick${'\n'}fail`));
    listProjects.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText('project.empty')).toBeInTheDocument());
    await user.click(screen.getByText('project.new'));
    await user.click(screen.getByTestId('project-browse-folder'));
    await waitFor(() => expect(screen.getByText('pick fail')).toBeInTheDocument());
  });

  it('shows export zip error and throw', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: sample });
    exportProjectZip
      .mockResolvedValueOnce({ ok: false, error: `export${'\n'}nope` })
      .mockRejectedValueOnce(new Error(`zip${'\0'}crash`));
    renderPage();
    await waitFor(() => expect(screen.getByText('Landing')).toBeInTheDocument());
    await user.click(screen.getByTestId('project-export-p1'));
    await waitFor(() => {
      expect(screen.getByTestId('project-zip-error')).toHaveTextContent('export nope');
    });
    await user.click(screen.getByTestId('project-export-p1'));
    await waitFor(() => {
      expect(screen.getByTestId('project-zip-error')).toHaveTextContent('zipcrash');
    });
  });

  it('rejects non-zip import and oversized zip', async () => {
    listProjects.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('project-zip-input')).toBeInTheDocument());
    const input = screen.getByTestId('project-zip-input') as HTMLInputElement;
    const { fireEvent } = await import('@testing-library/react');

    // Bypass accept= filter by dispatching change with FileList-like value
    const txt = new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [txt] } });
    await waitFor(() => {
      expect(screen.getByTestId('project-zip-error')).toHaveTextContent('project.importZipInvalid');
    });
    expect(importProjectZip).not.toHaveBeenCalled();

    const big = new File([new Uint8Array(10)], 'huge.zip', { type: 'application/zip' });
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    await waitFor(() => {
      expect(screen.getByTestId('project-zip-error')).toHaveTextContent('project.importZipTooLarge');
    });
    expect(importProjectZip).not.toHaveBeenCalled();
  });

  it('shows import zip API failure', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: [] });
    importProjectZip.mockResolvedValue({ ok: false, error: 'import blocked' });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('project-zip-input')).toBeInTheDocument());
    const input = screen.getByTestId('project-zip-input') as HTMLInputElement;
    const file = new File([new Uint8Array([0x50, 0x4b])], 'demo.zip', { type: 'application/zip' });
    await user.upload(input, file);
    await waitFor(() => {
      expect(screen.getByTestId('project-zip-error')).toHaveTextContent('import blocked');
    });
  });

  it('shows delete error and respects cancel', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: sample });
    deleteProject.mockResolvedValue({ ok: false, error: `del${'\n'}no` });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await waitFor(() => expect(screen.getByText('Landing')).toBeInTheDocument());
    await user.click(screen.getByText('common.delete'));
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith('p1'));
    expect(await screen.findByRole('alert')).toHaveTextContent('del no');

    confirmSpy.mockReturnValue(false);
    deleteProject.mockClear();
    await user.click(screen.getByText('common.delete'));
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('shows delete throw error', async () => {
    const user = userEvent.setup();
    listProjects.mockResolvedValue({ ok: true, data: sample });
    deleteProject.mockRejectedValue(new Error(`delete${'\0'}boom`));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await waitFor(() => expect(screen.getByText('Landing')).toBeInTheDocument());
    await user.click(screen.getByText('common.delete'));
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith('p1'));
    expect(await screen.findByRole('alert')).toHaveTextContent('deleteboom');
  });

});
