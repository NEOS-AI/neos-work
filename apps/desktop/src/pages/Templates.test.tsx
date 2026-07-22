import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const getTemplates = vi.fn();
const createWorkflow = vi.fn();
const navigate = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: { getTemplates, createWorkflow },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const { Templates } = await import('./Templates.js');

const templates = [
  {
    name: 'Finance Brief',
    description: 'Market brief',
    domain: 'finance' as const,
    nodes: [
      { id: 't', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} },
      { id: 'a', type: 'agent_finance', label: 'A', position: { x: 1, y: 0 }, config: {} },
    ],
    edges: [{ id: 'e1', source: 't', target: 'a' }],
  },
  {
    name: 'Code Review',
    description: 'Review PR',
    domain: 'coding' as const,
    nodes: [{ id: 't', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} }],
    edges: [],
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <Templates />
    </MemoryRouter>,
  );
}

describe('Templates page', () => {
  beforeEach(() => {
    getTemplates.mockReset();
    createWorkflow.mockReset();
    navigate.mockReset();
    localStorage.clear();
  });

  it('shows empty state when no templates', async () => {
    getTemplates.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    expect(screen.getByText('common.loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('No templates found.')).toBeInTheDocument();
    });
  });

  it('lists templates and filters by domain', async () => {
    const user = userEvent.setup();
    getTemplates.mockResolvedValue({ ok: true, data: templates });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Finance Brief')).toBeInTheDocument();
    });
    expect(screen.getByText('Code Review')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'finance' }));
    expect(screen.getByText('Finance Brief')).toBeInTheDocument();
    expect(screen.queryByText('Code Review')).not.toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(localStorage.getItem('neos-templates-domain')).toBe('finance');
  });

  it('filters by search and Escape clears', async () => {
    const user = userEvent.setup();
    getTemplates.mockResolvedValue({ ok: true, data: templates });
    renderPage();
    await waitFor(() => expect(screen.getByText('Finance Brief')).toBeInTheDocument());

    const search = screen.getByPlaceholderText('Search templates…');
    await user.type(search, 'Code');
    expect(screen.getByText('Code Review')).toBeInTheDocument();
    expect(screen.queryByText('Finance Brief')).not.toBeInTheDocument();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search templates…') as HTMLInputElement).value).toBe('');
    });
    expect(screen.getByText('Finance Brief')).toBeInTheDocument();
  });

  it('creates workflow from template and navigates', async () => {
    const user = userEvent.setup();
    getTemplates.mockResolvedValue({ ok: true, data: templates });
    createWorkflow.mockResolvedValue({ ok: true, data: { id: 'wf-new' } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Finance Brief')).toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: 'Use Template' })[0]!);
    await waitFor(() => {
      expect(createWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Finance Brief',
          domain: 'finance',
        }),
      );
      expect(navigate).toHaveBeenCalledWith('/workflows/wf-new');
    });
  });
});
