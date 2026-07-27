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

const client = {
      listWorkflows,
      createWorkflow,
      deleteWorkflow,
      duplicateWorkflow,
      importWorkflow,
      importWorkflowZip,
      importClaudeDesignZip,
    };

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client,
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

  it('shows scrubbed load error when listWorkflows fails', async () => {
    listWorkflows.mockResolvedValue({
      ok: false,
      error: `wf${'\n'}down${'\0'}!`,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('wf down!')).toBeInTheDocument();
    });
    expect(screen.queryByText('workflow.empty')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
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
      expect(createWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Workflow',
          primaryDomain: 'general',
          domainPackIds: ['general'],
        }),
      );
      expect(navigate).toHaveBeenCalledWith('/workflows/wf-new');
    });
  });

  it('rejects control-char workflow name without calling API', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
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
    expect(alertSpy).toHaveBeenCalledWith('Name contains invalid control characters');
    alertSpy.mockRestore();
  });

  it('alerts scrubbed create API error and keeps modal open', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    createWorkflow.mockResolvedValue({
      ok: false,
      error: `name${'\n'}taken${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderPage();
    await waitFor(() => expect(screen.getByText('workflow.empty')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: /workflow\.new/i })[0]!);
    const nameInput = await waitFor(() => {
      const inputs = document.querySelectorAll('input[type="text"]');
      expect(inputs.length).toBeGreaterThan(0);
      return inputs[0] as HTMLInputElement;
    });
    fireEvent.change(nameInput, { target: { value: 'Dup Name' } });
    const form = nameInput.closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(createWorkflow).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('name taken!');
    });
    expect(navigate).not.toHaveBeenCalled();
    expect((window.alert as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).not.toContain('\0');
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

  it('alerts scrubbed duplicate failure errors', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    duplicateWorkflow.mockResolvedValue({
      ok: false,
      error: `copy${'\n'}failed${'\0'}!`,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle('workflow.duplicate')[0]!);
    await waitFor(() => {
      expect(duplicateWorkflow).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('copy failed!');
    });
    expect((window.alert as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).not.toContain('\0');
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

  it('alerts scrubbed JSON import API / parse / null-byte failures', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    importWorkflow.mockResolvedValue({
      ok: false,
      error: `invalid${'\n'}graph${'\0'}!`,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());
    const jsonInput = document.querySelector('input[accept=".json"]') as HTMLInputElement;

    const payload = { name: 'Bad', domain: 'general', nodes: [], edges: [] };
    const file = new File([JSON.stringify(payload)], 'wf.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', {
      value: async () => JSON.stringify(payload),
    });
    fireEvent.change(jsonInput, { target: { files: [file] } });
    await waitFor(() => {
      expect(importWorkflow).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('invalid graph!');
    });

    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    importWorkflow.mockClear();
    const nullFile = new File(['x'], 'bad.json', { type: 'application/json' });
    Object.defineProperty(nullFile, 'text', {
      value: async () => `{"name":"x"${'\0'}}`,
    });
    fireEvent.change(jsonInput, { target: { files: [nullFile] } });
    await waitFor(() => {
      expect(importWorkflow).not.toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith(
        'JSON import failed: invalid control characters',
      );
    });

    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    const badJson = new File(['not-json'], 'bad.json', { type: 'application/json' });
    Object.defineProperty(badJson, 'text', {
      value: async () => 'not{json',
    });
    fireEvent.change(jsonInput, { target: { files: [badJson] } });
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalled();
      const msg = String((window.alert as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? '');
      expect(msg).not.toContain('\0');
      // parse error message scrubbed
      expect(msg.length).toBeGreaterThan(0);
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

  it('scrubs control-char ZIP / Claude Design import alert errors', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    importWorkflowZip.mockResolvedValue({
      ok: false,
      error: 'zip' + String.fromCharCode(0) + 'bad' + String.fromCharCode(10) + 'x',
    });
    importClaudeDesignZip.mockResolvedValue({
      ok: false,
      error: String.fromCharCode(0) + String.fromCharCode(10),
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());

    const zipInputs = Array.from(document.querySelectorAll('input[accept=".zip"]')) as HTMLInputElement[];
    expect(zipInputs.length).toBeGreaterThanOrEqual(2);

    fireEvent.change(zipInputs[0]!, {
      target: { files: [new File([new Uint8Array([1])], 'a.zip', { type: 'application/zip' })] },
    });
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('zipbad x');
    });

    (window.alert as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.change(zipInputs[1]!, {
      target: { files: [new File([new Uint8Array([2])], 'd.zip', { type: 'application/zip' })] },
    });
    await waitFor(() => {
      // Empty-after-scrub falls back
      expect(window.alert).toHaveBeenCalledWith('Claude Design import failed');
    });
  });

  it('scrubs control chars from workflow domain, name, and description', async () => {
    listWorkflows.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'wf-scrub',
          name: `Evil${'\0'}Flow`,
          domain: `coding${'\n'}x`,
          description: `line1${'\n'}line2`,
          nodes: [],
          edges: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('EvilFlow')).toBeInTheDocument());
    expect(screen.getByText(/coding x/)).toBeInTheDocument();
    expect(screen.getByText(/line1 line2/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('alerts scrubbed create throw and re-enables create form', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    createWorkflow.mockRejectedValue(new Error(`net${'\n'}down${'\0'}!`));
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    renderPage();
    await waitFor(() => expect(screen.getByText('workflow.empty')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: /workflow\.new/i })[0]!);
    const nameInput = await waitFor(() => {
      const inputs = document.querySelectorAll('input[type="text"]');
      expect(inputs.length).toBeGreaterThan(0);
      return inputs[0] as HTMLInputElement;
    });
    fireEvent.change(nameInput, { target: { value: 'Throw WF' } });
    const form = nameInput.closest('form');
    if (form) fireEvent.submit(form);

    await waitFor(() => {
      expect(createWorkflow).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('net down!');
    });
    expect(navigate).not.toHaveBeenCalled();
    expect((window.alert as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).not.toContain('\0');
  });

  it('alerts scrubbed delete throw and keeps the workflow', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    deleteWorkflow.mockRejectedValue(new Error(`del${'\n'}fail${'\0'}!`));
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle('common.delete')[0]!);
    await waitFor(() => {
      expect(deleteWorkflow).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('del fail!');
    });
    expect(screen.getByText('Alpha Flow')).toBeInTheDocument();
    expect((window.alert as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).not.toContain('\0');
  });

  it('copies workflow id and shows Copied feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle('Copy workflow ID')[0]!);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
      expect(screen.getByTitle('Copied!')).toBeInTheDocument();
    });
    // Scrubbed id (no control chars)
    const copied = String(writeText.mock.calls[0]?.[0] ?? '');
    expect(copied).not.toContain('\0');
    expect(copied.length).toBeGreaterThan(0);
  });

  it('shows Copy failed when workflow id clipboard write rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    listWorkflows.mockResolvedValue({ ok: true, data: workflows });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Flow')).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle('Copy workflow ID')[0]!);
    await waitFor(() => {
      expect(screen.getByTitle('Copy failed')).toBeInTheDocument();
    });
  });

  it('scrubs control chars from workflow id before clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    listWorkflows.mockResolvedValue({
      ok: true,
      data: [
        {
          id: `wf${'\0'}dirty`,
          name: 'Dirty Id Flow',
          domain: 'general' as const,
          description: '',
          nodes: [],
          edges: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Dirty Id Flow')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Copy workflow ID'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]?.[0]).toBe('wfdirty');
  });

  it('rejects delete/duplicate when workflow id has control chars', async () => {
    listWorkflows.mockResolvedValue({
      ok: true,
      data: [
        {
          id: `wf${'\0'}evil`,
          name: 'Evil Id Flow',
          domain: 'general' as const,
          description: '',
          nodes: [],
          edges: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await waitFor(() => expect(screen.getByText('Evil Id Flow')).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle('common.delete')[0]!);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deleteWorkflow).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Workflow id contains invalid control characters');

    alertSpy.mockClear();
    fireEvent.click(screen.getAllByTitle('workflow.duplicate')[0]!);
    expect(duplicateWorkflow).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Workflow id contains invalid control characters');
    alertSpy.mockRestore();
  });
});
