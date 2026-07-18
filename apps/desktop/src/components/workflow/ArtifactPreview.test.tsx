import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArtifactPreview, isHtmlContent, isMarkdownContent } from './ArtifactPreview.js';

const listArtifacts = vi.fn();
const getArtifact = vi.fn();
const refreshArtifact = vi.fn();
const deleteArtifact = vi.fn();

vi.mock('../../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: {
      listArtifacts,
      getArtifact,
      refreshArtifact,
      deleteArtifact,
    },
  }),
}));

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
});

describe('ArtifactPreview', () => {
  beforeEach(() => {
    listArtifacts.mockReset();
    getArtifact.mockReset();
    refreshArtifact.mockReset();
    deleteArtifact.mockReset();
  });

  it('shows empty state when no artifacts', async () => {
    listArtifacts.mockResolvedValue({ ok: true, data: [] });
    render(<ArtifactPreview workflowId="wf-1" />);
    await waitFor(() => {
      expect(screen.getByText(/no artifacts yet/i)).toBeInTheDocument();
    });
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
    await user.click(screen.getByRole('button', { name: /reload/i }));
    await waitFor(() => {
      expect(refreshArtifact).toHaveBeenCalledWith('a1', 'reload');
    });
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
});
