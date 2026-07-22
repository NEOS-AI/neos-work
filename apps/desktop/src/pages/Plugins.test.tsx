import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listPlugins = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: { listPlugins },
  }),
}));

vi.mock('../components/workflow/PipelineRunner.js', () => ({
  PipelineRunner: ({ plugin, onClose }: { plugin: { name: string }; onClose: () => void }) => (
    <div data-testid="pipeline-runner">
      Running {plugin.name}
      <button type="button" onClick={onClose}>
        close-runner
      </button>
    </div>
  ),
}));

const { Plugins } = await import('./Plugins.js');

const samplePlugins = [
  {
    id: 'p-b',
    name: 'Beta Plugin',
    version: '1.0.0',
    description: 'Second',
    pipeline: [{ id: 'a', name: 'A', kind: 'discovery' }],
  },
  {
    id: 'p-a',
    name: 'Alpha Plugin',
    version: '2.0.0',
    description: 'First alphabetically',
    pipeline: [
      { id: 'a', name: 'A', kind: 'discovery' },
      { id: 'b', name: 'B', kind: 'plan' },
    ],
  },
];

describe('Plugins page', () => {
  beforeEach(() => {
    listPlugins.mockReset();
  });

  it('shows empty state when no plugins', async () => {
    listPlugins.mockResolvedValue({ ok: true, data: [] });
    render(<Plugins />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/No plugins found/)).toBeInTheDocument();
    });
  });

  it('lists plugins sorted by name and opens runner', async () => {
    const user = userEvent.setup();
    listPlugins.mockResolvedValue({ ok: true, data: samplePlugins });
    render(<Plugins />);

    await waitFor(() => {
      expect(screen.getByText('Alpha Plugin')).toBeInTheDocument();
    });
    // sortByName → Alpha before Beta in DOM
    const names = screen.getAllByRole('heading', { level: 2 }).map((el) => el.textContent);
    expect(names[0]).toBe('Alpha Plugin');
    expect(names[1]).toBe('Beta Plugin');
    expect(screen.getByText(/v2\.0\.0 · 2 stages/)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Run' })[0]!);
    expect(screen.getByTestId('pipeline-runner')).toHaveTextContent('Running Alpha Plugin');

    await user.click(screen.getByRole('button', { name: 'close-runner' }));
    expect(screen.queryByTestId('pipeline-runner')).not.toBeInTheDocument();
  });

  it('filters by search and Escape clears search', async () => {
    const user = userEvent.setup();
    listPlugins.mockResolvedValue({ ok: true, data: samplePlugins });
    render(<Plugins />);
    await waitFor(() => expect(screen.getByText('Alpha Plugin')).toBeInTheDocument());

    const search = screen.getByPlaceholderText('Search plugins…');
    await user.type(search, 'Beta');
    expect(screen.getByText('Beta Plugin')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Plugin')).not.toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'zzzz');
    expect(screen.getByText('No plugins match your search.')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'Alpha');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search plugins…') as HTMLInputElement).value).toBe('');
    });
    expect(screen.getByText('Alpha Plugin')).toBeInTheDocument();
    expect(screen.getByText('Beta Plugin')).toBeInTheDocument();
  });

  it('ignores Escape when defaultPrevented or runner open', async () => {
    const user = userEvent.setup();
    listPlugins.mockResolvedValue({ ok: true, data: samplePlugins });
    render(<Plugins />);
    await waitFor(() => expect(screen.getByText('Alpha Plugin')).toBeInTheDocument());

    const search = screen.getByPlaceholderText('Search plugins…');
    await user.type(search, 'Alpha');

    const stop = (ev: KeyboardEvent) => ev.preventDefault();
    window.addEventListener('keydown', stop, true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    window.removeEventListener('keydown', stop, true);
    expect((search as HTMLInputElement).value).toBe('Alpha');

    // open runner — Escape handler inactive while selected
    await user.click(screen.getAllByRole('button', { name: 'Run' })[0]!);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect((screen.getByPlaceholderText('Search plugins…') as HTMLInputElement).value).toBe('Alpha');
  });
});
