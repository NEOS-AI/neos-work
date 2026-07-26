import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
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

  it('shows scrubbed load error when listRevisions fails', async () => {
    listRevisions.mockResolvedValue({
      ok: false,
      error: `rev${'\n'}down${'\0'}!`,
    });
    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('rev down!')).toBeInTheDocument();
    });
    expect(screen.queryByText(/no saved versions/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
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

  it('shows revision count in header and confirms before delete', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
          nodeCount: 1,
          edgeCount: 0,
        },
        {
          id: 'rev-2',
          workflowId: 'wf-1',
          label: 'Snap B',
          createdAt: '2026-01-02T00:00:00.000Z',
          nodeCount: 2,
          edgeCount: 1,
        },
      ],
    });
    deleteRevision.mockResolvedValue({ ok: true });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Snap A')).toBeInTheDocument();
    });
    expect(screen.getByText('(2)')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /delete/i })[0]!);
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(deleteRevision).toHaveBeenCalledWith('wf-1', 'rev-1');
    });

    confirmSpy.mockRestore();
  });

  it('does not delete when confirm is cancelled', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Snap A')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /delete/i }));
    expect(deleteRevision).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('alerts scrubbed error when revision delete fails', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    deleteRevision.mockResolvedValue({
      ok: false,
      error: `locked${'\n'}rev${'\0'}!`,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => expect(screen.getByText('Snap A')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => {
      expect(deleteRevision).toHaveBeenCalledWith('wf-1', 'rev-1');
      expect(window.alert).toHaveBeenCalledWith('locked rev!');
    });
    expect(screen.getByText('Snap A')).toBeInTheDocument();
  });

  it('alerts scrubbed error when revision restore fetch fails', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getRevision.mockResolvedValue({
      ok: false,
      error: `gone${'\n'}rev${'\0'}!`,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => expect(screen.getByText('Snap A')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => {
      expect(getRevision).toHaveBeenCalledWith('wf-1', 'rev-1');
      expect(window.alert).toHaveBeenCalledWith('gone rev!');
    });
    expect(onRestore).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('alerts scrubbed error when revision restore throws', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getRevision.mockRejectedValue(new Error(`sock${'\n'}reset${'\0'}!`));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => expect(screen.getByText('Snap A')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => {
      expect(getRevision).toHaveBeenCalledWith('wf-1', 'rev-1');
      expect(window.alert).toHaveBeenCalledWith('sock reset!');
    });
    expect(onRestore).not.toHaveBeenCalled();
    // Restore button should not remain stuck as "…"
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
  });

  it('alerts when revision snapshot is invalid JSON', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    getRevision.mockResolvedValue({
      ok: true,
      data: {
        id: 'rev-1',
        workflowId: 'wf-1',
        snapshot: '{not-json',
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => expect(screen.getByText('Snap A')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /restore/i }));
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Invalid snapshot');
    });
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('alerts scrubbed error when revision label update fails', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    updateRevisionLabel.mockResolvedValue({
      ok: false,
      error: `label${'\n'}locked${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => expect(screen.getByText('Snap A')).toBeInTheDocument());
    await user.click(screen.getByText('Snap A'));
    const input = await screen.findByDisplayValue('Snap A');
    await user.clear(input);
    await user.type(input, 'Deploy ready{Enter}');
    await waitFor(() => {
      expect(updateRevisionLabel).toHaveBeenCalledWith('wf-1', 'rev-1', 'Deploy ready');
      expect(window.alert).toHaveBeenCalledWith('label locked!');
    });
    // Still editing (not cleared on failure)
    expect(screen.getByDisplayValue('Deploy ready')).toBeInTheDocument();
  });

  it('closes on Escape when not editing a label', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Snap A')).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape while editing cancels without saving the label', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    updateRevisionLabel.mockResolvedValue({ ok: true });

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Snap A')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Snap A'));
    const input = await screen.findByDisplayValue('Snap A');
    await user.clear(input);
    await user.type(input, 'Should not save');
    await user.keyboard('{Escape}');

    expect(updateRevisionLabel).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // back to display mode with original label
    await waitFor(() => {
      expect(screen.getByText('Snap A')).toBeInTheDocument();
    });
  });

  it('saves revision label on Enter', async () => {
    const user = userEvent.setup();
    listRevisions
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            id: 'rev-1',
            workflowId: 'wf-1',
            label: 'Snap A',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValue({
        ok: true,
        data: [
          {
            id: 'rev-1',
            workflowId: 'wf-1',
            label: 'Deploy ready',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
    updateRevisionLabel.mockResolvedValue({ ok: true });

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await waitFor(() => expect(screen.getByText('Snap A')).toBeInTheDocument());
    await user.click(screen.getByText('Snap A'));
    const input = await screen.findByDisplayValue('Snap A');
    await user.clear(input);
    await user.type(input, 'Deploy ready{Enter}');

    await waitFor(() => {
      expect(updateRevisionLabel).toHaveBeenCalledWith('wf-1', 'rev-1', 'Deploy ready');
    });
    // loadRevisions after save picks up the new label
    await waitFor(() => {
      expect(screen.getByText('Deploy ready')).toBeInTheDocument();
    });
  });

  it('Escape preventDefault so stacked listeners do not double-fire', async () => {
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Snap A')).toBeInTheDocument();
    });

    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores Escape when defaultPrevented is already set', async () => {
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Snap A')).toBeInTheDocument();
    });

    const stop = (ev: KeyboardEvent) => ev.preventDefault();
    window.addEventListener('keydown', stop, true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', stop, true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('rejects control-char revision labels without calling API', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await waitFor(() => expect(screen.getByText('Snap A')).toBeInTheDocument());
    await user.click(screen.getByText('Snap A'));
    const input = await screen.findByDisplayValue('Snap A');
    // Use null-byte (jsdom text inputs strip \n/\r from values)
    fireEvent.change(input, { target: { value: `bad${'\0'}label` } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(updateRevisionLabel).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Label contains invalid control characters');
    await waitFor(() => {
      expect(screen.getByText('Snap A')).toBeInTheDocument();
    });
  });

  it('rejects overlong revision labels without calling API', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await waitFor(() => expect(screen.getByText('Snap A')).toBeInTheDocument());
    await user.click(screen.getByText('Snap A'));
    const input = await screen.findByDisplayValue('Snap A');
    // maxLength=200 on the input; fireEvent can still push >200 into controlled state
    fireEvent.change(input, { target: { value: 'L'.repeat(201) } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(updateRevisionLabel).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('Snap A')).toBeInTheDocument();
    });
  });

  it('rejects blank revision labels without calling API', async () => {
    const user = userEvent.setup();
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'rev-1',
          workflowId: 'wf-1',
          label: 'Snap A',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await waitFor(() => expect(screen.getByText('Snap A')).toBeInTheDocument());
    await user.click(screen.getByText('Snap A'));
    const input = await screen.findByDisplayValue('Snap A');
    await user.clear(input);
    await user.keyboard('{Enter}');

    expect(updateRevisionLabel).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText('Snap A')).toBeInTheDocument();
    });
  });


    it('scrubs control-char revision labels', async () => {
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'r1',
          workflowId: 'wf',
          label: 'v1' + String.fromCharCode(0) + 'x',
          createdAt: '2020-01-01T00:00:00.000Z',
          nodeCount: 2,
          edgeCount: 1,
        },
      ],
    });
    render(
      <RevisionPanel
        workflowId="wf"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => expect(screen.getByText('v1x')).toBeInTheDocument());
  });

  it('seeds label edit input with scrubbed revision label', async () => {
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'r1',
          workflowId: 'wf',
          label: `Snap${'\0'}A${'\n'}B`,
          createdAt: '2020-01-01T00:00:00.000Z',
          nodeCount: 1,
          edgeCount: 0,
        },
      ],
    });
    render(
      <RevisionPanel
        workflowId="wf"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => expect(screen.getByText(/SnapA B/)).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Click to add label'));
    const input = await screen.findByDisplayValue('SnapA B');
    expect((input as HTMLInputElement).value).not.toContain('\0');
    expect((input as HTMLInputElement).value).not.toMatch(/[\r\n]/);
  });


  it('rejects restore/delete when revision id has control chars', async () => {
    listRevisions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: `rev${'\0'}evil`,
          workflowId: 'wf-1',
          label: 'Evil Rev',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <RevisionPanel
        workflowId="wf-1"
        client={client}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );
    await waitFor(() => expect(screen.getByText('Evil Rev')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /workflow\.restore|Restore/i }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(getRevision).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Revision id contains invalid control characters');

    alertSpy.mockClear();
    confirmSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Delete|workflow\.delete/i }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deleteRevision).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Revision id contains invalid control characters');
    alertSpy.mockRestore();
  });

});
