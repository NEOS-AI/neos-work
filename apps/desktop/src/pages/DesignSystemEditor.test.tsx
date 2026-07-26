import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const listDesignSystems = vi.fn();
const getDesignSystemContent = vi.fn();
const saveDesignSystemContent = vi.fn();
const navigate = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: { listDesignSystems, getDesignSystemContent, saveDesignSystemContent },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ id: 'ds-1' }),
  };
});

const { DesignSystemEditor } = await import('./DesignSystemEditor.js');

function renderEditor() {
  return render(
    <MemoryRouter>
      <DesignSystemEditor />
    </MemoryRouter>,
  );
}

describe('DesignSystemEditor page', () => {
  beforeEach(() => {
    listDesignSystems.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'ds-1', name: 'Brand X', description: '', updatedAt: '2026-01-01T00:00:00.000Z' }],
    });
    getDesignSystemContent.mockReset().mockResolvedValue({
      ok: true,
      data: { content: '# Brand\ncolors' },
    });
    saveDesignSystemContent.mockReset().mockResolvedValue({ ok: true });
    navigate.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('loads design system content', async () => {
    renderEditor();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Brand X')).toBeInTheDocument();
    });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Brand\ncolors');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows scrubbed load error when design system is missing', async () => {
    listDesignSystems.mockResolvedValue({ ok: true, data: [] });
    renderEditor();
    await waitFor(() => {
      expect(screen.getByText('Design system not found')).toBeInTheDocument();
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows scrubbed error when list design systems fails', async () => {
    listDesignSystems.mockResolvedValue({
      ok: false,
      error: `list${'\n'}down${'\0'}!`,
    });
    renderEditor();
    await waitFor(() => {
      expect(screen.getByText('list down!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('shows scrubbed banner when DESIGN.md content fails to load', async () => {
    getDesignSystemContent.mockResolvedValue({
      ok: false,
      error: `read${'\n'}fail${'\0'}!`,
    });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    expect(screen.getByText('read fail!')).toBeInTheDocument();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(document.body.textContent).not.toContain('\0');
  });

  it('strips null bytes from loaded DESIGN.md content seed', async () => {
    getDesignSystemContent.mockResolvedValue({
      ok: true,
      data: { content: `# Brand${'\0'}\ncolors` },
    });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.value).toBe('# Brand\ncolors');
    expect(ta.value).not.toContain('\0');
  });

  it('saves dirty content via button and shows toast', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '# Updated' } });
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(saveDesignSystemContent).toHaveBeenCalledWith('ds-1', '# Updated');
      expect(screen.getByText('Saved')).toBeInTheDocument();
    });
  });

  it('rejects null-byte and empty content without calling API', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: `# bad${'\0'}content` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
    expect(
      screen.getByText('Save failed: content contains invalid control characters'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
    expect(screen.getByText('Save failed: content cannot be empty')).toBeInTheDocument();
  });

  it('saves via Cmd/Ctrl+S', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Brand\ncolors!' } });
    fireEvent.keyDown(window, { key: 's', metaKey: true });

    await waitFor(() => {
      expect(saveDesignSystemContent).toHaveBeenCalledWith('ds-1', '# Brand\ncolors!');
    });
  });

  it('shows save failure message', async () => {
    saveDesignSystemContent.mockResolvedValue({ ok: false, error: 'disk full' });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.getByText(/Save failed: disk full/)).toBeInTheDocument();
    });
  });

  it('back with dirty content confirms then navigates', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Brand\ncolors dirty' } });
    // dirty indicator
    expect(screen.getByText('●')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Design Systems/ }));
    expect(window.confirm).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/design-systems');
  });

  it('Escape triggers back when loaded', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/design-systems');
    });
  });

  it('ignores Escape when defaultPrevented', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    const stop = (ev: KeyboardEvent) => ev.preventDefault();
    window.addEventListener('keydown', stop, true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', stop, true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('scrubs control-char design system name in breadcrumb', async () => {
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ds-1',
          name: `Brand${'\0'}X${'\n'}Y`,
          description: '',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    renderEditor();
    await waitFor(() => {
      // null-byte stripped; newline collapsed for breadcrumb
      expect(screen.getByText(/BrandX Y/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('scrubs control chars in save failure toast text', async () => {
    saveDesignSystemContent.mockResolvedValue({
      ok: false,
      error: `disk${'\n'}full${'\0'}!`,
    });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      // Store-time scrub collapses newlines / strips null before setSaveMessage
      expect(screen.getByText(/Save failed: disk full!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('surfaces scrubbed save throw and clears Saving… busy state', async () => {
    saveDesignSystemContent.mockRejectedValue(new Error(`net${'\n'}down${'\0'}!`));
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: '# throw path' } });
    expect((ta as HTMLTextAreaElement).value).toBe('# throw path');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(saveDesignSystemContent).toHaveBeenCalledWith('ds-1', '# throw path');
      expect(screen.getByText(/Save failed: net down!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    // finally clears saving — label returns to Save (not stuck on Saving…)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument();
    });
  });
});
