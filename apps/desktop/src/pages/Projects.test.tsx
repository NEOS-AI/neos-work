import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const listProjects = vi.fn();
const createProject = vi.fn();
const deleteProject = vi.fn();
const navigate = vi.fn();

const client = { listProjects, createProject, deleteProject };

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
    deleteProject.mockReset();
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
      expect(navigate).toHaveBeenCalledWith('/projects/new1');
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
});
