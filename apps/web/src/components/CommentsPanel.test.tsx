import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CommentsPanel } from './CommentsPanel.js';

describe('CommentsPanel', () => {
  it('shows the desktop-only Promote hint and no Promote button', async () => {
    const listPreviewComments = vi.fn().mockResolvedValue({ ok: true, data: [] });
    const client = {
      listPreviewComments,
      createPreviewComment: vi.fn(),
      deletePreviewComment: vi.fn(),
    };
    render(
      <CommentsPanel
        projectId="p1"
        filePath="index.html"
        selectionSelector={null}
        client={client}
      />,
    );
    await waitFor(() => expect(listPreviewComments).toHaveBeenCalled());
    expect(
      screen.getByText('Promote to RULES.md is available in the desktop app.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('web-promote-desktop-only')).toHaveTextContent(
      'Promote to RULES.md is available in the desktop app.',
    );
    expect(screen.queryByRole('button', { name: /promote/i })).toBeNull();
    expect(screen.getByTestId('web-comment-add')).toBeInTheDocument();
  });
});
