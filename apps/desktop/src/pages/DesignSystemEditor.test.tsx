import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const listDesignSystems = vi.fn();
const getDesignSystemContent = vi.fn();
const saveDesignSystemContent = vi.fn();
const getDesignSystemRules = vi.fn();
const saveDesignSystemRules = vi.fn();
const getDesignSystemTokens = vi.fn();
const saveDesignSystemTokens = vi.fn();
const pruneDesignSystemRules = vi.fn();
const appendDesignSystemRules = vi.fn();
const navigate = vi.fn();

const client = {
  listDesignSystems,
  getDesignSystemContent,
  saveDesignSystemContent,
  getDesignSystemRules,
  saveDesignSystemRules,
  getDesignSystemTokens,
  saveDesignSystemTokens,
  pruneDesignSystemRules,
  appendDesignSystemRules,
};

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

async function openTab(name: 'design' | 'rules' | 'tokens') {
  fireEvent.click(screen.getByRole('tab', { name: `designSystems.tab.${name}` }));
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
    getDesignSystemRules.mockReset().mockResolvedValue({
      ok: true,
      data: { content: '# Agent rules\n' },
    });
    getDesignSystemTokens.mockReset().mockResolvedValue({
      ok: true,
      data: { content: ':root { --x: 1; }' },
    });
    saveDesignSystemRules.mockReset().mockResolvedValue({ ok: true });
    saveDesignSystemTokens.mockReset().mockResolvedValue({ ok: true });
    pruneDesignSystemRules.mockReset().mockResolvedValue({ ok: true, data: { pruned: 2 } });
    appendDesignSystemRules.mockReset().mockResolvedValue({ ok: true });
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
    expect(getDesignSystemRules).not.toHaveBeenCalled();
    expect(getDesignSystemTokens).not.toHaveBeenCalled();
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
    expect(saveDesignSystemTokens).not.toHaveBeenCalled();
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

  it('keeps in-flight keystrokes dirty after save resolves', async () => {
    let resolveSave!: (value: { ok: true }) => void;
    saveDesignSystemContent.mockImplementation(
      () => new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(saveDesignSystemContent).toHaveBeenCalledWith('ds-1', '# Updated');
      expect(screen.getByRole('button', { name: 'designSystems.saving' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Updated extra' } });
    resolveSave({ ok: true });

    await waitFor(() => {
      expect(screen.getByText('designSystems.saved')).toBeInTheDocument();
    });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Updated extra');
    expect(screen.getByText('●')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'designSystems.back' }));
    expect(window.confirm).toHaveBeenCalledWith('designSystems.unsavedLeave');
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

  it('renders three editor tabs and keeps independent dirty buffers', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    const designTab = screen.getByRole('tab', { name: 'designSystems.tab.design' });
    const rulesTab = screen.getByRole('tab', { name: 'designSystems.tab.rules' });
    const tokensTab = screen.getByRole('tab', { name: 'designSystems.tab.tokens' });
    expect(designTab).toHaveAttribute('aria-selected', 'true');
    expect(rulesTab).toHaveAttribute('aria-selected', 'false');
    expect(tokensTab).toHaveAttribute('aria-selected', 'false');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Brand\ncolors');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Updated' } });
    expect(screen.getByText('●')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeDisabled();

    await openTab('rules');
    expect(window.confirm).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Agent rules\n');
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    expect(screen.getByText('●')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Agent rules\n\nextra' } });
    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(saveDesignSystemRules).toHaveBeenCalledWith('ds-1', '# Agent rules\n\nextra');
    });
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
    expect(saveDesignSystemTokens).not.toHaveBeenCalled();

    await openTab('design');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('# Updated');
    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeDisabled();
  });

  it('Save on a clean RULES tab does not PUT DESIGN even if DESIGN is dirty', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Updated' } });
    await openTab('rules');
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
    expect(saveDesignSystemTokens).not.toHaveBeenCalled();
  });

  it('GET rules 404 shows §5 placeholder that is not dirty; first edit then Save PUTs', async () => {
    getDesignSystemRules.mockResolvedValue({ ok: false, error: 'Not found' });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    expect(screen.queryByText('●')).not.toBeInTheDocument();

    await openTab('rules');
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.value).toBe('designSystems.rulesPlaceholder');
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    expect(screen.queryByText('●')).not.toBeInTheDocument();
    expect(saveDesignSystemRules).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(saveDesignSystemRules).not.toHaveBeenCalled();

    fireEvent.change(ta, { target: { value: `${ta.value}!` } });
    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(saveDesignSystemRules).toHaveBeenCalledWith(
        'ds-1',
        'designSystems.rulesPlaceholder!',
      );
    });
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
  });

  it('untouched 404 placeholder is never PUT', async () => {
    getDesignSystemRules.mockResolvedValue({ ok: false, error: 'Not found' });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    await openTab('rules');
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
  });

  it('GET tokens 404 is empty and not dirty; empty Save stays disabled', async () => {
    getDesignSystemTokens.mockResolvedValue({ ok: false, error: 'Not found' });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    await openTab('tokens');
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(saveDesignSystemTokens).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: ':root{--a:1;}' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(saveDesignSystemTokens).toHaveBeenCalledWith('ds-1', ':root{--a:1;}');
    });
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
  });

  it('view mode makes all three tabs readonly', async () => {
    routeQuery.mode = 'view';
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    const designTa = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(designTa).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'common.save' })).not.toBeInTheDocument();
    expect(screen.getByText('designSystems.viewHint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'designSystems.startEdit' })).toBeInTheDocument();

    await openTab('rules');
    const rulesTa = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(rulesTa).toHaveAttribute('readonly');
    expect(screen.getByText('designSystems.viewHint')).toBeInTheDocument();
    fireEvent.change(rulesTa, { target: { value: '# should not stick' } });
    expect(rulesTa.value).toBe('# Agent rules\n');
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
    expect(saveDesignSystemContent).not.toHaveBeenCalled();
    expect(saveDesignSystemTokens).not.toHaveBeenCalled();

    await openTab('tokens');
    const tokensTa = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(tokensTa).toHaveAttribute('readonly');
    fireEvent.change(tokensTa, { target: { value: ':root{--no:1;}' } });
    expect(tokensTa.value).toBe(':root { --x: 1; }');
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(saveDesignSystemTokens).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'designSystems.startEdit' }));
    expect(navigate).toHaveBeenCalledWith('/design-systems/ds-1');
  });

  it('leave-warn if any tab is dirty', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    await openTab('rules');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Agent rules\n\ndirty' } });
    await openTab('design');
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'designSystems.back' }));
    expect(window.confirm).toHaveBeenCalledWith('designSystems.unsavedLeave');
    expect(navigate).toHaveBeenCalledWith('/design-systems');

    vi.mocked(window.confirm).mockClear();
    navigate.mockClear();
    await openTab('tokens');
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('leave-warn for dirty tokens with clean DESIGN and RULES', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    await openTab('tokens');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ':root { --x: 2; }' } });
    fireEvent.click(screen.getByRole('button', { name: 'designSystems.back' }));
    expect(window.confirm).toHaveBeenCalledWith('designSystems.unsavedLeave');
    expect(navigate).toHaveBeenCalledWith('/design-systems');
  });

  it('bundled rules/tokens tabs are readonly and Save is a no-op with 403 copy', async () => {
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [{
        id: 'ds-1',
        name: 'Brand X',
        description: '',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'bundled',
      }],
    });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    await openTab('rules');
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/designSystems\.rulesSaveFailed:Bundled design systems are read-only/)).toBeInTheDocument();
    });

    await openTab('tokens');
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(saveDesignSystemTokens).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText(/designSystems\.tokensSaveFailed:Bundled design systems are read-only/)).toBeInTheDocument();
    });

    await openTab('design');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Updated bundled' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(saveDesignSystemContent).toHaveBeenCalledWith('ds-1', '# Updated bundled');
    });
  });

  it('rules/tokens save failures use the tab-specific saveFailed keys', async () => {
    saveDesignSystemRules.mockResolvedValue({ ok: false, error: 'disk full' });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    await openTab('rules');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Agent rules\n\nfail' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(screen.getByText('designSystems.rulesSaveFailed:disk full')).toBeInTheDocument();
    });

    saveDesignSystemTokens.mockRejectedValue(new Error(`net${'\n'}down${'\0'}!`));
    await openTab('tokens');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ':root { --x: 9; }' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => {
      expect(screen.getByText('designSystems.tokensSaveFailed:net down!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.save' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'designSystems.saving' })).not.toBeInTheDocument();
    });
  });

  it('null-byte and empty bodies are rejected for rules and tokens without calling API', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    await openTab('rules');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: `bad${'\0'}x` } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
    expect(screen.getByText('designSystems.invalidContent')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
    expect(screen.getByText('designSystems.emptyContent')).toBeInTheDocument();

    await openTab('tokens');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: `bad${'\0'}x` } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(saveDesignSystemTokens).not.toHaveBeenCalled();
    expect(screen.getByText('designSystems.invalidContent')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    expect(saveDesignSystemTokens).not.toHaveBeenCalled();
    expect(screen.getByText('designSystems.emptyContent')).toBeInTheDocument();
  });

  it('shows rulesHint on the RULES tab in edit mode', async () => {
    const { unmount } = renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    expect(screen.getByText('designSystems.hint')).toBeInTheDocument();
    expect(screen.queryByText('designSystems.rulesHint')).not.toBeInTheDocument();

    await openTab('rules');
    expect(screen.getByText('designSystems.rulesHint')).toBeInTheDocument();

    unmount();
    routeQuery.mode = 'view';
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    expect(screen.getByText('designSystems.viewHint')).toBeInTheDocument();
    await openTab('rules');
    expect(screen.getByText('designSystems.viewHint')).toBeInTheDocument();
    expect(screen.queryByText('designSystems.rulesHint')).not.toBeInTheDocument();
  });

  it('RULES tab prune confirm POSTs prune and reloads rules', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());

    expect(screen.queryByTestId('ds-prune')).not.toBeInTheDocument();
    await openTab('tokens');
    expect(screen.queryByTestId('ds-prune')).not.toBeInTheDocument();

    await openTab('rules');
    const pruneBtn = screen.getByTestId('ds-prune');
    expect(pruneBtn).toHaveTextContent('designSystems.prune');
    expect(pruneBtn).not.toBeDisabled();

    getDesignSystemRules.mockResolvedValue({
      ok: true,
      data: { content: '# Agent rules\n\n## Corrections\n' },
    });
    fireEvent.click(pruneBtn);
    expect(window.confirm).toHaveBeenCalledWith('designSystems.pruneConfirm');
    await waitFor(() => {
      expect(pruneDesignSystemRules).toHaveBeenCalledTimes(1);
    });
    const args = pruneDesignSystemRules.mock.calls[0];
    expect(args[0]).toBe('ds-1');
    if (args[1] !== undefined) {
      expect(args[1]).toEqual({});
      expect(args[1]).not.toHaveProperty('maxEntries');
      expect(args[1]).not.toHaveProperty('maxAgeDays');
    }
    await waitFor(() => {
      expect(getDesignSystemRules.mock.calls.length).toBeGreaterThan(1);
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
        '# Agent rules\n\n## Corrections\n',
      );
    });
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
    expect(saveDesignSystemRules).not.toHaveBeenCalled();
    expect(appendDesignSystemRules).not.toHaveBeenCalled();
  });

  it('cancelling prune confirm does not call the API', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    await openTab('rules');
    const before = (screen.getByRole('textbox') as HTMLTextAreaElement).value;
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId('ds-prune'));
    expect(window.confirm).toHaveBeenCalledWith('designSystems.pruneConfirm');
    expect(pruneDesignSystemRules).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(before);
  });

  it('prune disabled for bundled, view mode, missing RULES file, and dirty RULES buffer', async () => {
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [{
        id: 'ds-1',
        name: 'Brand X',
        description: '',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'bundled',
      }],
    });
    const bundled = renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    await openTab('rules');
    expect(screen.getByTestId('ds-prune')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ds-prune'));
    expect(pruneDesignSystemRules).not.toHaveBeenCalled();
    bundled.unmount();

    routeQuery.mode = 'view';
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [{ id: 'ds-1', name: 'Brand X', description: '', updatedAt: '2026-01-01T00:00:00.000Z' }],
    });
    const view = renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    expect(screen.queryByTestId('ds-prune')).not.toBeInTheDocument();
    await openTab('rules');
    expect(screen.queryByTestId('ds-prune')).not.toBeInTheDocument();
    await openTab('tokens');
    expect(screen.queryByTestId('ds-prune')).not.toBeInTheDocument();
    view.unmount();
    routeQuery.mode = '';

    getDesignSystemRules.mockResolvedValue({ ok: false, error: 'Not found' });
    const missing = renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    await openTab('rules');
    expect(screen.getByTestId('ds-prune')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ds-prune'));
    expect(pruneDesignSystemRules).not.toHaveBeenCalled();
    missing.unmount();

    getDesignSystemRules.mockResolvedValue({
      ok: true,
      data: { content: '# Agent rules\n' },
    });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    await openTab('rules');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '# Agent rules\n!' } });
    expect(screen.getByTestId('ds-prune')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'common.save' })).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('ds-prune'));
    expect(pruneDesignSystemRules).not.toHaveBeenCalled();
  });

  it('prune 404/403/throw surfaces a scrubbed error without adding i18n keys', async () => {
    pruneDesignSystemRules.mockResolvedValue({ ok: false, error: 'Not found' });
    renderEditor();
    await waitFor(() => expect(screen.getByText('Brand X')).toBeInTheDocument());
    await openTab('rules');
    fireEvent.click(screen.getByTestId('ds-prune'));
    await waitFor(() => {
      expect(screen.getByText(/Not found/)).toBeInTheDocument();
    });
    expect(screen.queryByText('designSystems.pruneFailed')).not.toBeInTheDocument();

    pruneDesignSystemRules.mockRejectedValue(new Error(`net${'\n'}down${'\0'}!`));
    fireEvent.click(screen.getByTestId('ds-prune'));
    await waitFor(() => {
      expect(screen.getByText(/net down!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.save' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'designSystems.saving' })).not.toBeInTheDocument();
    });
  });
});
