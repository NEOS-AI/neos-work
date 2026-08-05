import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listProjects = vi.fn();
const createProject = vi.fn();

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
  });

  it('lists projects', async () => {
    renderProjects();
    await waitFor(() => {
      expect(screen.getByText('Existing')).toBeInTheDocument();
    });
    expect(screen.getByTestId('project-create-form')).toBeInTheDocument();
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
});
