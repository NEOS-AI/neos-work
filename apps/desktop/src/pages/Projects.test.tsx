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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => {
      if (key === 'project.confirmDelete' && opts?.name) return `Delete ${opts.name}?`;
      return key;
    },
  }),
}));

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
});
