import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listProjects = vi.fn();
const createProject = vi.fn();
const updateProject = vi.fn();
const deleteProject = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({
    serverUrl: 'http://127.0.0.1:3000',
    token: 'test-token',
  }),
  clearConnection: vi.fn(),
}));

vi.mock('../lib/api.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/api.js')>('../lib/api.js');
  return {
    ...actual,
    WebApiClient: class {
      listProjects = listProjects;
      createProject = createProject;
      updateProject = updateProject;
      deleteProject = deleteProject;
    },
  };
});

const { Projects } = await import('./Projects.js');

function renderProjects() {
  return render(
    <MemoryRouter initialEntries={['/projects']}>
      <Routes>
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<div data-testid="project-detail">detail</div>} />
        <Route path="/" element={<div>connect</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Projects page', () => {
  beforeEach(() => {
    listProjects.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'p1', name: 'Existing', entryFile: 'index.html' }],
    });
    createProject.mockReset().mockResolvedValue({
      ok: true,
      data: { id: 'p-new', name: 'Landing' },
    });
    updateProject.mockReset().mockResolvedValue({
      ok: true,
      data: { id: 'p1', name: 'Renamed' },
    });
    deleteProject.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
  });

  it('lists projects', async () => {
    renderProjects();
    await waitFor(() => {
      expect(screen.getByText('Existing')).toBeInTheDocument();
    });
    expect(screen.getByTestId('project-create-form')).toBeInTheDocument();
    expect(screen.getByTestId('project-rename-p1')).toBeInTheDocument();
    expect(screen.getByTestId('project-delete-p1')).toBeInTheDocument();
  });

  it('creates a project and navigates to detail', async () => {
    renderProjects();
    await waitFor(() => expect(screen.getByTestId('project-create-name')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('project-create-name'), {
      target: { value: 'Landing' },
    });
    fireEvent.click(screen.getByTestId('project-create-submit'));
    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith({ name: 'Landing' });
    });
    await waitFor(() => {
      expect(screen.getByTestId('project-detail')).toBeInTheDocument();
    });
  });

  it('surfaces create errors without navigating', async () => {
    createProject.mockResolvedValue({ ok: false, error: `quota${'\n'}full${'\0'}` });
    renderProjects();
    await waitFor(() => expect(screen.getByTestId('project-create-name')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('project-create-name'), {
      target: { value: 'Nope' },
    });
    fireEvent.click(screen.getByTestId('project-create-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('project-create-error')).toHaveTextContent(/quota full/);
    });
    expect(document.body.textContent).not.toContain('\0');
    expect(screen.queryByTestId('project-detail')).not.toBeInTheDocument();
  });

  it('renames a project inline', async () => {
    renderProjects();
    await waitFor(() => expect(screen.getByTestId('project-rename-p1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('project-rename-p1'));
    const input = screen.getByTestId('project-rename-input-p1');
    expect(input).toHaveValue('Existing');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId('project-rename-save-p1'));
    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith('p1', { name: 'Renamed' });
    });
    await waitFor(() => {
      expect(screen.getByText('Renamed')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('project-rename-input-p1')).not.toBeInTheDocument();
  });

  it('cancels rename without calling API', async () => {
    renderProjects();
    await waitFor(() => expect(screen.getByTestId('project-rename-p1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('project-rename-p1'));
    fireEvent.click(screen.getByTestId('project-rename-cancel-p1'));
    expect(updateProject).not.toHaveBeenCalled();
    expect(screen.queryByTestId('project-rename-input-p1')).not.toBeInTheDocument();
  });

  it('surfaces scrubbed rename errors', async () => {
    updateProject.mockResolvedValue({ ok: false, error: `rename${'\n'}no${'\0'}` });
    renderProjects();
    await waitFor(() => expect(screen.getByTestId('project-rename-p1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('project-rename-p1'));
    fireEvent.change(screen.getByTestId('project-rename-input-p1'), {
      target: { value: 'Nope' },
    });
    fireEvent.click(screen.getByTestId('project-rename-save-p1'));
    await waitFor(() => {
      expect(screen.getByTestId('project-action-error')).toHaveTextContent(/rename no/);
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('deletes a project after confirm', async () => {
    renderProjects();
    await waitFor(() => expect(screen.getByTestId('project-delete-p1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('project-delete-p1'));
    await waitFor(() => {
      expect(deleteProject).toHaveBeenCalledWith('p1');
    });
    await waitFor(() => {
      expect(screen.queryByText('Existing')).not.toBeInTheDocument();
    });
  });

  it('skips delete when confirm is cancelled', async () => {
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    renderProjects();
    await waitFor(() => expect(screen.getByTestId('project-delete-p1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('project-delete-p1'));
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('surfaces scrubbed delete errors', async () => {
    deleteProject.mockResolvedValue({ ok: false, error: `del${'\n'}no${'\0'}` });
    renderProjects();
    await waitFor(() => expect(screen.getByTestId('project-delete-p1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('project-delete-p1'));
    await waitFor(() => {
      expect(screen.getByTestId('project-action-error')).toHaveTextContent(/del no/);
    });
    expect(screen.getByText('Existing')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });
});
