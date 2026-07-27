import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const getTemplates = vi.fn();
const createWorkflow = vi.fn();
const navigate = vi.fn();

const client = { getTemplates, createWorkflow };

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client,
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

    // Domain filter coding
    await user.click(screen.getByRole('button', { name: 'coding' }));
    expect(screen.getByText('Code Review')).toBeInTheDocument();
    expect(screen.queryByText('Finance Brief')).not.toBeInTheDocument();
    expect(localStorage.getItem('neos-templates-domain')).toBe('coding');
    await user.click(screen.getByRole('button', { name: 'all' }));

    const search = screen.getByPlaceholderText('Search templates…');
    await user.type(search, 'Code');
    expect(screen.getByText('Code Review')).toBeInTheDocument();
    expect(screen.queryByText('Finance Brief')).not.toBeInTheDocument();

    // Escape with defaultPrevented must not clear search
    const stop = (ev: KeyboardEvent) => ev.preventDefault();
    window.addEventListener('keydown', stop, true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', stop, true);
    expect((search as HTMLInputElement).value).toBe('Code');

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
          primaryDomain: 'finance',
          domainPackIds: ['finance'],
        }),
      );
      expect(navigate).toHaveBeenCalledWith('/workflows/wf-new');
    });
  });

  it('shows no-match search and does not navigate when create fails', async () => {
    const user = userEvent.setup();
    getTemplates.mockResolvedValue({ ok: true, data: templates });
    createWorkflow.mockResolvedValue({ ok: false, error: 'boom' });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderPage();
    await waitFor(() => expect(screen.getByText('Finance Brief')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search templates…'), 'zzzz-none');
    expect(screen.queryByText('Finance Brief')).not.toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText('Search templates…'));
    await waitFor(() => expect(screen.getByText('Finance Brief')).toBeInTheDocument());

    await user.click(screen.getAllByRole('button', { name: 'Use Template' })[0]!);
    await waitFor(() => {
      expect(createWorkflow).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('boom');
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('alerts scrubbed create API error when template use fails', async () => {
    const user = userEvent.setup();
    getTemplates.mockResolvedValue({ ok: true, data: templates });
    createWorkflow.mockResolvedValue({
      ok: false,
      error: `quota${'\n'}exceeded${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderPage();
    await waitFor(() => expect(screen.getByText('Finance Brief')).toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: 'Use Template' })[0]!);
    await waitFor(() => {
      expect(createWorkflow).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('quota exceeded!');
    });
    expect(navigate).not.toHaveBeenCalled();
    expect((window.alert as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).not.toContain('\0');
  });

  it('shows scrubbed load error when getTemplates is non-ok', async () => {
    getTemplates.mockResolvedValue({
      ok: false,
      error: `tpl${'\n'}down${'\0'}!`,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('tpl down!')).toBeInTheDocument();
    });
    expect(screen.queryByText('No templates found.')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('shows node/edge counts and required settings badges', async () => {
    getTemplates.mockResolvedValue({
      ok: true,
      data: [
        {
          name: 'Slack Alert',
          description: 'Notify on deploy',
          domain: 'general' as const,
          nodes: [
            { id: 't', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} },
            { id: 's', type: 'slack_message', label: 'S', position: { x: 1, y: 0 }, config: {} },
            { id: 'w', type: 'web_search', label: 'W', position: { x: 2, y: 0 }, config: {} },
          ],
          edges: [
            { id: 'e1', source: 't', target: 's' },
            { id: 'e2', source: 's', target: 'w' },
          ],
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Slack Alert')).toBeInTheDocument());
    expect(screen.getByText('3 nodes · 2 edges')).toBeInTheDocument();
    expect(screen.getByText('SLACK_BOT_TOKEN')).toBeInTheDocument();
    expect(screen.getByText('TAVILY_API_KEY')).toBeInTheDocument();
  });

  it('disables Use Template while a create is in flight', async () => {
    const user = userEvent.setup();
    let resolveCreate: (v: unknown) => void = () => {};
    createWorkflow.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    getTemplates.mockResolvedValue({ ok: true, data: templates });
    renderPage();
    await waitFor(() => expect(screen.getByText('Finance Brief')).toBeInTheDocument());

    const buttons = screen.getAllByRole('button', { name: 'Use Template' });
    await user.click(buttons[0]!);
    await waitFor(() => {
      expect(screen.getByText('...')).toBeInTheDocument();
      // All Use Template buttons disabled while creating
      for (const b of screen.getAllByRole('button', { name: /\.\.\.|Use Template/ })) {
        expect(b).toBeDisabled();
      }
    });

    resolveCreate({ ok: true, data: { id: 'wf-late' } });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/workflows/wf-late'));
  });

  it('scrubs control-char template labels and skips control-char name on Use', async () => {
    const user = userEvent.setup();
    getTemplates.mockResolvedValue({
      ok: true,
      data: [
        {
          name: `Evil${'\0'}Tpl`,
          description: `desc${'\n'}line`,
          domain: `coding${'\n'}x`,
          nodes: [{ id: 't', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} }],
          edges: [],
        },
        {
          name: 'Safe Tpl',
          description: 'ok',
          domain: 'general',
          nodes: [{ id: 't', type: 'trigger', label: 'T', position: { x: 0, y: 0 }, config: {} }],
          edges: [],
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('EvilTpl')).toBeInTheDocument());
    // domain collapsed for badge
    expect(screen.getByText(/coding x/)).toBeInTheDocument();
    // description collapsed
    expect(screen.getByText(/desc line/)).toBeInTheDocument();

    // Control-char name template: Use alerts and does not call API
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const useButtons = screen.getAllByRole('button', { name: 'Use Template' });
    await user.click(useButtons[0]!);
    expect(createWorkflow).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Template name contains invalid control characters');
    alertSpy.mockRestore();

    createWorkflow.mockResolvedValue({ ok: true, data: { id: 'wf-safe' } });
    await user.click(useButtons[1]!);
    await waitFor(() => expect(createWorkflow).toHaveBeenCalled());
    expect(createWorkflow.mock.calls[0]![0].name).toBe('Safe Tpl');
  });
});
