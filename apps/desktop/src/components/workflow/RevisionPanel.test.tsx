import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RevisionPanel } from './RevisionPanel.js';
import type { EngineClient } from '../../lib/engine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

describe('RevisionPanel', () => {
  const listRevisions = vi.fn();
  const getRevision = vi.fn();
  const updateRevisionLabel = vi.fn();
  const deleteRevision = vi.fn();
  const onClose = vi.fn();
  const onRestore = vi.fn();

  const client = {
    listRevisions,
    getRevision,
    updateRevisionLabel,
    deleteRevision,
  } as unknown as EngineClient;

  beforeEach(() => {
    listRevisions.mockReset();
    getRevision.mockReset();
    updateRevisionLabel.mockReset();
    deleteRevision.mockReset();
    onClose.mockReset();
    onRestore.mockReset();
  });

  it('shows empty state', async () => {
    listRevisions.mockResolvedValue({ ok: true, data: [] });
    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/no saved versions/i)).toBeInTheDocument();
    });
  });

  it('lists revisions with node counts and restores after confirm', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Before deploy',
          createdAt: '2026-01-01T00:00:00.000Z',
          nodeCount: 3,
          edgeCount: 2,
        },
      ],
    });
    getRevision.mockResolvedValue({
      ok: true,
      data: {
        id: 'rev-1',
        workflowId: 'wf-1',
        snapshot: JSON.stringify({
          nodes: [{ id: 'n1' }],
          edges: [],
          description: 'd',
          designSystemId: 'ds-1',
        }),
      },
    });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        isDirty
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Before deploy')).toBeInTheDocument();
    });
    expect(screen.getByText(/3 nodes/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => {
      expect(onRestore).toHaveBeenCalledWith(
        expect.objectContaining({
          designSystemId: 'ds-1',
          description: 'd',
        }),
      );
      expect(onClose).toHaveBeenCalled();
    });
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('cancels restore when user declines confirm', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-2',
          workflowId: 'wf-1',
          createdAt: '2026-01-02T00:00:00.000Z',
          nodeCount: 1,
        },
      ],
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        isDirty={false}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => expect(screen.getByText(/auto-save/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /restore/i }));
    expect(getRevision).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
