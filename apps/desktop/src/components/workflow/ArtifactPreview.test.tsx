import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArtifactPreview, downloadTextFile, isHtmlContent, isMarkdownContent } from './ArtifactPreview.js';

const listArtifacts = vi.fn();
const getArtifact = vi.fn();
const refreshArtifact = vi.fn();
const deleteArtifact = vi.fn();
const updateArtifact = vi.fn();

vi.mock('../../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: {
      listArtifacts,
      getArtifact,
      refreshArtifact,
      deleteArtifact,
      updateArtifact,
    },
  }),
}));

describe('downloadTextFile', () => {
  it('creates an object URL and clicks a download anchor', () => {
    const click = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const origCreate = document.createElement.bind(document);
    const createEl = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: click });
      }
      return el;
    });
    downloadTextFile('out.html', '<html></html>', 'text/html');
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
    createEl.mockRestore();
  });

  it('scrubs control-char filename/mime and null-byte body', () => {
    const click = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:safe');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const origCreate = document.createElement.bind(document);
    let downloadName = '';
    const createEl = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        Object.defineProperty(el, 'click', { value: click });
        Object.defineProperty(el, 'download', {
          configurable: true,
          get: () => downloadName,
          set: (v: string) => {
            downloadName = v;
          },
        });
      }
      return el;
    });

    downloadTextFile(`evil${'\0'}name\n.html`, `body${'\0'}x`, `text/plain${'\n'}`);
    expect(downloadName).toBe('evil_name_.html');
    expect(createObjectURL).toHaveBeenCalled();
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/plain');

    // blank-after-scrub / overlong name
    downloadTextFile('   ', 'x');
    expect(downloadName).toBe('artifact.txt');
    downloadTextFile('n'.repeat(250), 'y');
    expect(downloadName.length).toBe(200);

    createEl.mockRestore();
  });
});

describe('isHtmlContent / isMarkdownContent', () => {
  it('detects html by content-type and content sniffing', () => {
    expect(isHtmlContent('text/html', null)).toBe(true);
    expect(isHtmlContent(undefined, '<!DOCTYPE html><html></html>')).toBe(true);
    expect(isHtmlContent(undefined, '  <html lang="en">')).toBe(true);
    expect(isHtmlContent(undefined, 'plain')).toBe(false);
  });

  it('detects markdown by type or extension', () => {
    expect(isMarkdownContent('text/markdown', 'x')).toBe(true);
    expect(isMarkdownContent('text/md', 'x')).toBe(true);
    expect(isMarkdownContent('text/plain', 'notes.md')).toBe(true);
    expect(isMarkdownContent('text/plain', 'notes.txt')).toBe(false);
  });

  it('rejects control-char contentType / null-byte body / control names', () => {
    expect(isHtmlContent(`text/html${'\0'}`, null)).toBe(false);
    expect(isHtmlContent('\ntext/html', null)).toBe(false);
    expect(isHtmlContent(undefined, `<html>${'\0'}</html>`)).toBe(false);
    expect(isMarkdownContent(`text/markdown${'\0'}`, 'x')).toBe(false);
    expect(isMarkdownContent('text/plain', `notes${'\0'}.md`)).toBe(false);
    expect(isMarkdownContent('text/plain', '\nnotes.md')).toBe(false);
  });
});

describe('ArtifactPreview', () => {
  beforeEach(() => {
    listArtifacts.mockReset();
    getArtifact.mockReset();
    refreshArtifact.mockReset();
    deleteArtifact.mockReset();
    updateArtifact.mockReset();
    localStorage.clear();
  });

  it('shows empty state when no artifacts', async () => {
    listArtifacts.mockResolvedValue({ ok: true, data: [] });
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => {
      expect(screen.getByText(/no artifacts yet/i)).toBeInTheDocument();
    });
  });

  it('shows scrubbed list error when listArtifacts fails', async () => {
    listArtifacts.mockResolvedValue({
      ok: false,
      error: `arts${'\n'}down${'\0'}!`,
    });
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => {
      expect(screen.getByText('arts down!')).toBeInTheDocument();
    });
    expect(screen.queryByText(/no artifacts yet/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('shows scrubbed content error when getArtifact fails', async () => {
    const art = {
      id: 'a1',
      workflowId: 'wf-1',
      name: 'page.html',
      contentType: 'text/html',
      content: '<html></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({
      ok: false,
      error: `content${'\n'}gone${'\0'}!`,
    });
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByText('page.html')).toBeInTheDocument());
    await waitFor(() => {
      expect(getArtifact).toHaveBeenCalledWith('a1');
      expect(screen.getByText('content gone!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('renders HTML artifact in iframe and supports viewport + reload', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a1',
      workflowId: 'wf-1',
      name: 'page.html',
      contentType: 'text/html',
      content: '<html><body>hi</body></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    refreshArtifact.mockResolvedValue({ ok: true, data: art, meta: { mode: 'reload' } });

    render(<ArtifactPreview workflowId="wf-1" onRerunWorkflow={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('page.html')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.querySelector('iframe')).toBeTruthy();
    });

    expect(screen.getByRole('button', { name: /mobile/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /mobile/i }));
    expect(localStorage.getItem('neos-artifact-viewport')).toBe('mobile');
    await user.click(screen.getByRole('button', { name: /reload/i }));
    await waitFor(() => {
      expect(refreshArtifact).toHaveBeenCalledWith('a1', 'reload');
    });
  });

  it('shows scrubbed status when artifact reload fails', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a1',
      workflowId: 'wf-1',
      name: 'page.html',
      contentType: 'text/html',
      content: '<html><body>hi</body></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact
      .mockResolvedValueOnce({ ok: true, data: art }) // initial select load
      .mockResolvedValue({ ok: false, error: 'gone' }); // fallback after failed refresh
    refreshArtifact.mockResolvedValue({
      ok: false,
      error: `reload${'\n'}denied${'\0'}!`,
    });

    render(<ArtifactPreview workflowId="wf-1" onRerunWorkflow={() => {}} />);
    await waitFor(() => expect(screen.getByText('page.html')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /reload/i }));
    await waitFor(() => {
      expect(refreshArtifact).toHaveBeenCalledWith('a1', 'reload');
      expect(screen.getByText('reload denied!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('restores viewport mode from localStorage prefs', async () => {
    localStorage.setItem('neos-artifact-viewport', 'tablet');
    const art = {
      id: 'a1',
      workflowId: 'wf-1',
      name: 'page.html',
      contentType: 'text/html',
      content: '<html><body>hi</body></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });

    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => {
      expect(document.querySelector('iframe')).toBeTruthy();
    });
    const tablet = screen.getByRole('button', { name: /tablet/i });
    // Selected viewport chip uses the solid highlight class
    expect(tablet.className).toContain('bg-white/15');
  });

  it('renders markdown as preformatted text', async () => {
    const art = {
      id: 'a2',
      workflowId: 'wf-1',
      name: 'notes.md',
      contentType: 'text/markdown',
      content: '# Hello\n\nWorld',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });

    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => {
      expect(screen.getByText(/# Hello/)).toBeInTheDocument();
    });
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('deletes selected artifact after confirm', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a3',
      workflowId: 'wf-1',
      name: 'gone.html',
      contentType: 'text/html',
      content: '<html></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Keep returning the artifact until delete succeeds (StrictMode double-mount safe)
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    deleteArtifact.mockImplementation(async () => {
      listArtifacts.mockResolvedValue({ ok: true, data: [] });
      return { ok: true };
    });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByText('gone.html')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => {
      expect(deleteArtifact).toHaveBeenCalledWith('a3');
    });
    confirmSpy.mockRestore();
  });

  it('cancels delete when confirm is false', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a3b',
      workflowId: 'wf-1',
      name: 'keep.html',
      contentType: 'text/html',
      content: '<html></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByText('keep.html')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(deleteArtifact).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('renames selected artifact via prompt', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a4',
      workflowId: 'wf-1',
      name: 'old-name.html',
      contentType: 'text/html',
      content: '<html></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    updateArtifact.mockImplementation(async (_id: string, input: { name?: string }) => {
      const renamed = { ...art, name: input.name ?? art.name };
      listArtifacts.mockResolvedValue({ ok: true, data: [renamed] });
      return { ok: true, data: renamed };
    });

    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('new-name.html');
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByText('old-name.html')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /rename/i }));
    await waitFor(() => {
      expect(updateArtifact).toHaveBeenCalledWith('a4', { name: 'new-name.html' });
    });
    promptSpy.mockRestore();
  });

  it('skips rename when prompt is cancelled', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a5',
      workflowId: 'wf-1',
      name: 'keep.html',
      contentType: 'text/html',
      content: '<html></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByText('keep.html')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /rename/i }));
    expect(updateArtifact).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('rejects control-char rename with Invalid name status', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a6',
      workflowId: 'wf-1',
      name: 'safe.html',
      contentType: 'text/html',
      content: '<html></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('bad\nname.html');
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByText('safe.html')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /rename/i }));
    expect(updateArtifact).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('Invalid name')).toBeInTheDocument();
    });
    promptSpy.mockRestore();
  });

  it('rejects overlong rename with Invalid name status', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a7',
      workflowId: 'wf-1',
      name: 'short.html',
      contentType: 'text/html',
      content: '<html></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(`${'n'.repeat(201)}.html`);
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByText('short.html')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /rename/i }));
    expect(updateArtifact).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('Invalid name')).toBeInTheDocument();
    });
    promptSpy.mockRestore();
  });

  it('skips blank or unchanged rename without calling API', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a8',
      workflowId: 'wf-1',
      name: 'same.html',
      contentType: 'text/html',
      content: '<html></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    const promptSpy = vi.spyOn(window, 'prompt');
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByText('same.html')).toBeInTheDocument());

    promptSpy.mockReturnValue('   ');
    await user.click(screen.getByRole('button', { name: /rename/i }));
    expect(updateArtifact).not.toHaveBeenCalled();
    expect(screen.queryByText('Invalid name')).not.toBeInTheDocument();

    promptSpy.mockReturnValue('  same.html  ');
    await user.click(screen.getByRole('button', { name: /rename/i }));
    expect(updateArtifact).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('scrubs control-char artifact names in tab list', async () => {
    listArtifacts.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'a1',
          workflowId: 'wf-1',
          name: 'Out' + String.fromCharCode(0) + 'put.html',
          contentType: 'text/html',
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        },
      ],
    });
    getArtifact.mockResolvedValue({
      ok: true,
      data: {
        id: 'a1',
        workflowId: 'wf-1',
        name: 'Out' + String.fromCharCode(0) + 'put.html',
        contentType: 'text/html',
        content: '<html></html>',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
    });
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByText('Output.html')).toBeInTheDocument());
  });

  it('scrubs control-char delete/rename API errors in status banner', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a-err',
      workflowId: 'wf-1',
      name: 'x.html',
      contentType: 'text/html',
      content: '<html></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    deleteArtifact.mockResolvedValue({
      ok: false,
      error: `delete${'\n'}denied${'\0'}!`,
    });
    updateArtifact.mockResolvedValue({
      ok: false,
      error: `rename${'\0'}fail\nnow`,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('new-name.html');

    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByText('x.html')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => {
      expect(screen.getByText(/delete denied!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');

    await user.click(screen.getByRole('button', { name: /rename/i }));
    expect(promptSpy).toHaveBeenCalledWith('Rename artifact', 'x.html');
    await waitFor(() => {
      expect(screen.getByText(/renamefail now/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    promptSpy.mockRestore();
  });

  it('scrubs rename prompt seed and re-run meta status message', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a-seed',
      workflowId: 'wf-1',
      name: 'Out' + String.fromCharCode(0) + 'put' + String.fromCharCode(10) + '.html',
      contentType: 'text/html',
      content: '<html></html>',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);

    const { unmount } = render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByText(/Output/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /rename/i }));
    expect(promptSpy).toHaveBeenCalled();
    const seed = String(promptSpy.mock.calls[0]?.[1] ?? '');
    // null stripped, LF collapsed to space
    expect(seed).toBe('Output .html');
    expect(seed).not.toContain('\0');
    promptSpy.mockRestore();
    unmount();

    // Re-run button only when onRerunWorkflow is provided; success meta scrubbed
    refreshArtifact.mockResolvedValueOnce({
      ok: true,
      meta: {
        mode: 'rerun',
        message: 'Re' + String.fromCharCode(0) + 'run' + String.fromCharCode(10) + 'queued',
      },
    });
    const onRerun = vi.fn();
    render(<ArtifactPreview workflowId="wf-1" onRerunWorkflow={onRerun} />);
    await waitFor(() => expect(screen.getByText(/Output/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /▶ Re-run|Re-run/i }));
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Rerun queued|Re run queued/);
    });
    expect(document.body.textContent).not.toContain('\0');
    expect(onRerun).toHaveBeenCalled();
  });

  it('shows scrubbed list error when listArtifacts fails', async () => {
    listArtifacts.mockResolvedValue({
      ok: false,
      error: `arts${'\n'}down${'\0'}!`,
    });
    render(<ArtifactPreview workflowId="wf-1" onRerunWorkflow={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('arts down!')).toBeInTheDocument();
    });
    expect(screen.queryByText(/No artifacts yet/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('copies scrubbed artifact content and shows Copied', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const art = {
      id: 'a-copy',
      workflowId: 'wf-1',
      name: 'out.txt',
      contentType: 'text/plain',
      content: `hello${'\0'}world`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Copy$/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^Copy$/i }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
      expect(String(writeText.mock.calls[0]?.[0] ?? '')).toBe('helloworld');
      expect(screen.getByRole('button', { name: /Copied/i })).toBeInTheDocument();
    });
  });

  it('shows Copy failed when clipboard write rejects', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const art = {
      id: 'a-copy-fail',
      workflowId: 'wf-1',
      name: 'out.txt',
      contentType: 'text/plain',
      content: 'x',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    render(<ArtifactPreview workflowId="wf-1" />);
    const copyBtn = await screen.findByTitle('Copy artifact content');
    expect(copyBtn).toBeEnabled();
    await user.click(copyBtn);
    // Status toast and/or button label surface the failure
    await waitFor(() => {
      expect(screen.getAllByText('Copy failed').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows Download failed when blob URL creation throws', async () => {
    const user = userEvent.setup();
    const art = {
      id: 'a-dl-fail',
      workflowId: 'wf-1',
      name: 'out.txt',
      contentType: 'text/plain',
      content: 'payload',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    listArtifacts.mockResolvedValue({ ok: true, data: [art] });
    getArtifact.mockResolvedValue({ ok: true, data: art });
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('blob denied');
    });
    render(<ArtifactPreview workflowId="wf-1" />);
    const dlBtn = await screen.findByTitle('Download artifact');
    expect(dlBtn).toBeEnabled();
    await user.click(dlBtn);
    await waitFor(() => {
      expect(screen.getByText('Download failed')).toBeInTheDocument();
    });
    createSpy.mockRestore();
  });

});
