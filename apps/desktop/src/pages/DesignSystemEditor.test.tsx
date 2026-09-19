import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const listDesignSystems = vi.fn();
const getDesignSystemContent = vi.fn();
const saveDesignSystemContent = vi.fn();
const navigate = vi.fn();

const client = { listDesignSystems, getDesignSystemContent, saveDesignSystemContent };

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client,
  }),
}));

vi.mock('react-i18next', () => {
  const t = (key: string, opts?: { name?: string; detail?: string }) => {
    if (opts?.name) return `${key}:${opts.name}`;
    if (opts?.detail) return `${key}:${opts.detail}`;
    return key;
  };
  return { useTranslation: () => ({ t }) };
});

const routeParams = { id: 'ds-1' as string };
const routeQuery = { mode: '' as string };

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ id: routeParams.id }),
    useSearchParams: () => {
      const p = new URLSearchParams();
      if (routeQuery.mode) p.set('mode', routeQuery.mode);
      return [p];
    },
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
    routeParams.id = 'ds-1';
    routeQuery.mode = '';
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

  it('rejects control-char route id without calling content APIs', async () => {
    routeParams.id = `ds${'\n'}1`;
    renderEditor();
    await waitFor(() => {
      expect(
        screen.getByText('designSystems.invalidId'),
      ).toBeInTheDocument();
    });
    expect(listDesignSystems).not.toHaveBeenCalled();
    expect(getDesignSystemContent).not.toHaveBeenCalled();
  });

  it('loads design system content', async () => {
    renderEditor();
    expect(screen.getByText('common.loading')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Brand X')).toBeInTheDocument();
    });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Brand\ncolors');
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
  });

  it('shows scrubbed load error when design system is missing', async () => {
    listDesignSystems.mockResolvedValue({ ok: true, data: [] });
    renderEditor();
    await waitFor(() => {
      expect(screen.getByText('designSystems.notFound')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(saveDesignSystemContent).toHaveBeenCalledWith('ds-1', '# Updated');
      expect(screen.getByText('designSystems.saved')).toBeInTheDocument();
    });
  });

  it('rejects null-byte and empty content without calling API', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: `# bad${'\0'}content` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
    expect(screen.getByText('designSystems.invalidContent')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
    expect(screen.getByText('designSystems.emptyContent')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(screen.getByText('designSystems.saveFailed:disk full')).toBeInTheDocument();
    });
  });

  it('back with dirty content confirms then navigates', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Brand\ncolors dirty' } });
    // dirty indicator
    expect(screen.getByText('●')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'designSystems.back' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      // Store-time scrub collapses newlines / strips null before setSaveMessage
      expect(screen.getByText('designSystems.saveFailed:disk full!')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(saveDesignSystemContent).toHaveBeenCalledWith('ds-1', '# throw path');
      expect(screen.getByText('designSystems.saveFailed:net down!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    // finally clears saving — label returns to Save (not stuck on Saving…)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.save' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'designSystems.saving' })).not.toBeInTheDocument();
    });
  });

  it('opens read-only view and switches to edit via startEdit', async () => {
    routeQuery.mode = 'view';
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta).toHaveAttribute('readonly');
    expect(screen.getByText('designSystems.readOnly')).toBeInTheDocument();
    expect(screen.getByText('designSystems.viewHint')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.save' })).not.toBeInTheDocument();

    fireEvent.change(ta, { target: { value: '# should not stick' } });
    expect(ta.value).toBe('# Brand\ncolors');
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(saveDesignSystemContent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'designSystems.startEdit' }));
    expect(navigate).toHaveBeenCalledWith('/design-systems/ds-1');
  });

  it('does not start edit from view when route id is invalid', async () => {
    routeParams.id = `ds${'\n'}1`;
    routeQuery.mode = 'view';
    renderEditor();
    await waitFor(() => {
      expect(screen.getByText('designSystems.invalidId')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'designSystems.startEdit' })).not.toBeInTheDocument();
  });
});
