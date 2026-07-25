import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const listWorkflows = vi.fn();
const createWorkflow = vi.fn();
const deleteWorkflow = vi.fn();
const duplicateWorkflow = vi.fn();
const importWorkflow = vi.fn();
const importWorkflowZip = vi.fn();
const importClaudeDesignZip = vi.fn();
const navigate = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: {
      listWorkflows,
      createWorkflow,
      deleteWorkflow,
      duplicateWorkflow,
      importWorkflow,
      importWorkflowZip,
      importClaudeDesignZip,
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { Workflows } = await import('./Workflows.js');

const workflows = [
  {
    id: 'wf-b',
    name: 'Beta Flow',
    domain: 'coding' as const,
    description: '',
    nodes: [],
    edges: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'wf-a',
    name: 'Alpha Flow',
    domain: 'finance' as const,
    description: '',
    nodes: [],
    edges: [],
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <Workflows />
    </MemoryRouter>,
  );
}

describe('Workflows page', () => {
  beforeEach(() => {
    listWorkflows.mockReset();
    createWorkflow.mockReset();
    deleteWorkflow.mockReset();
    duplicateWorkflow.mockReset();
    importWorkflow.mockReset();
    importWorkflowZip.mockReset();
    importClaudeDesignZip.mockReset();
    navigate.mockReset();
    localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('trig-1')
      .mockReturnValueOnce('out-1')
      .mockReturnValue('edge-1');
  });

  it('shows empty state', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('workflow.empty')).toBeInTheDocument();
    });
  });

  it('lists workflows and filters by domain/search', async () => {
    const user = userEvent.setup();
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    renderPage();

    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());
    expect(screen.getByText('Beta Flow')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'finance' }));
    expect(screen.getByText('Alpha Flow')).toBeInTheDocument();
    expect(screen.queryByText('Beta Flow')).not.toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'all' }));
    await user.type(screen.getByPlaceholderText('Search workflows…'), 'Beta');
    expect(screen.getByText('Beta Flow')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Flow')).not.toBeInTheDocument();
  });

  it('Escape clears search and closes create modal', async () => {
    const user = userEvent.setup();
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search workflows…'), 'x');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search workflows…') as HTMLInputElement).value).toBe('');
    });

    // open create modal via header + New
    fireEvent.click(screen.getByRole('button', { name: /\+?\s*workflow\.new/i }));
    await waitFor(() => {
      // modal has name input
      expect(screen.getByRole('textbox') || document.querySelector('input[type="text"]')).toBeTruthy();
    });
  });

  it('creates workflow and navigates to editor', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    createWorkflow.mockResolvedValue({ ok: true, data: { id: 'wf-new' } });
    renderPage();
    await waitFor(() => expect(screen.getByText('workflow.empty')).toBeInTheDocument());

    // empty state new button
    const newButtons = screen.getAllByRole('button', { name: /workflow\.new/i });
    fireEvent.click(newButtons[0]!);

    // fill name — find text input in modal
    const nameInput = await waitFor(() => {
      const inputs = document.querySelectorAll('input[type="text"]');
      expect(inputs.length).toBeGreaterThan(0);
      return inputs[0] as HTMLInputElement;
    });
    fireEvent.change(nameInput, { target: { value: 'My Workflow' } });

    // submit form
    const form = nameInput.closest('form');
    if (form) {
      fireEvent.submit(form);
    } else {
      fireEvent.click(screen.getByRole('button', { name: /create|save|workflow/i }));
    }

    await waitFor(() => {
      expect(createWorkflow).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith('/workflows/wf-new');
    });
  });

  it('rejects control-char workflow name without calling API', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText('workflow.empty')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: /workflow\.new/i })[0]!);
    const nameInput = await waitFor(() => {
      const inputs = document.querySelectorAll('input[type="text"]');
      expect(inputs.length).toBeGreaterThan(0);
      return inputs[0] as HTMLInputElement;
    });
    fireEvent.change(nameInput, { target: { value: `bad${'\0'}name` } });
    const form = nameInput.closest('form');
    if (form) fireEvent.submit(form);
    expect(createWorkflow).not.toHaveBeenCalled();
  });

  it('deletes a workflow after confirm', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    deleteWorkflow.mockResolvedValue({ ok: true });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());

    // stop card navigation — click delete if present
    const deleteBtns = screen.queryAllByRole('button', { name: /delete|workflow\.delete|common\.delete/i });
    if (deleteBtns.length === 0) {
      // try title attributes or text
      const all = screen.getAllByRole('button');
      const del = all.find((b) => /delete/i.test(b.textContent ?? '') || /delete/i.test(b.getAttribute('title') ?? ''));
      expect(del).toBeTruthy();
      fireEvent.click(del!);
    } else {
      fireEvent.click(deleteBtns[0]!);
    }

    await waitFor(() => {
      expect(deleteWorkflow).toHaveBeenCalled();
    });
  });

  it('duplicates a workflow and cancels delete when confirm is false', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    duplicateWorkflow.mockResolvedValue({ ok: true, data: { id: 'wf-copy' } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());

    const dup = screen.getAllByTitle('workflow.duplicate')[0]!;
    fireEvent.click(dup);
    await waitFor(() => {
      expect(duplicateWorkflow).toHaveBeenCalled();
    });

    deleteWorkflow.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getAllByTitle('common.delete')[0]!);
    expect(deleteWorkflow).not.toHaveBeenCalled();
  });

  it('shows no-match filter empty state', async () => {
    const user = userEvent.setup();
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Search workflows…'), 'zzzz-no-match');
    expect(screen.queryByText('Alpha Flow')).not.toBeInTheDocument();
    expect(screen.queryByText('Beta Flow')).not.toBeInTheDocument();
    // counter reflects filter
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });

  it('imports JSON workflow and navigates to editor', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    importWorkflow.mockResolvedValue({ ok: true, data: { id: 'wf-imported' } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());

    const jsonInput = document.querySelector('input[accept=".json"]') as HTMLInputElement;
    expect(jsonInput).toBeTruthy();
    const payload = { name: 'Imported', domain: 'general', nodes: [], edges: [] };
    const file = new File([JSON.stringify(payload)], 'wf.json', { type: 'application/json' });
    // jsdom File may lack Blob.text()
    Object.defineProperty(file, 'text', {
      value: async () => JSON.stringify(payload),
    });
    fireEvent.change(jsonInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(importWorkflow).toHaveBeenCalledWith(payload);
      expect(navigate).toHaveBeenCalledWith('/workflows/wf-imported');
    });
  });

  it('imports ZIP and Claude Design ZIP; alerts on failure', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    importWorkflowZip.mockResolvedValue({ ok: true, data: { id: 'wf-zip' } });
    importClaudeDesignZip.mockResolvedValue({ ok: false, error: 'bad zip' });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());

    const zipInputs = Array.from(document.querySelectorAll('input[accept=".zip"]')) as HTMLInputElement[];
    expect(zipInputs.length).toBeGreaterThanOrEqual(2);

    const zipFile = new File([new Uint8Array([1, 2, 3])], 'wf.zip', { type: 'application/zip' });
    fireEvent.change(zipInputs[0]!, { target: { files: [zipFile] } });
    await waitFor(() => {
      expect(importWorkflowZip).toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith('/workflows/wf-zip');
    });

    navigate.mockClear();
    const designFile = new File([new Uint8Array([9])], 'design.zip', { type: 'application/zip' });
    fireEvent.change(zipInputs[1]!, { target: { files: [designFile] } });
    await waitFor(() => {
      expect(importClaudeDesignZip).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('bad zip');
      expect(navigate).not.toHaveBeenCalled();
    });
  });
});
