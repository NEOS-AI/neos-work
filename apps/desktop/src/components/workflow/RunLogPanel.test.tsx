import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunLogPanel, filterRunLogEvents, linkifyText } from './RunLogPanel.js';
import type { WorkflowSSEEvent } from '../../lib/engine.js';

describe('RunLogPanel', () => {
  it('shows empty state', () => {
    render(<RunLogPanel events={[]} nodeLabelMap={{}} />);
    expect(screen.getByText(/no runs/i)).toBeInTheDocument();
  });

  it('renders started and progress events', () => {
    const events: WorkflowSSEEvent[] = [
      { type: 'run.started', runId: 'run-abcdef12' },
      { type: 'node.started', nodeId: 'n1', nodeType: 'agent_coding' },
      { type: 'node.progress', nodeId: 'n1', chunk: 'hi', accumulated: 'hi there' },
    ];
    render(<RunLogPanel events={events} nodeLabelMap={{ n1: 'Coder' }} />);
    expect(screen.getByText(/Run run-abcd/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Coder/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/streaming/i)).toBeInTheDocument();
  });

  it('renders completed and failed events', async () => {
    const user = userEvent.setup();
    const events: WorkflowSSEEvent[] = [
      { type: 'node.completed', nodeId: 'n1', output: { ok: true }, durationMs: 12 },
      { type: 'node.failed', nodeId: 'n2', error: 'boom' },
      { type: 'run.completed', runId: 'run-1', duration: 99 },
    ];
    render(<RunLogPanel events={events} nodeLabelMap={{ n1: 'A', n2: 'B' }} />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    await user.click(screen.getByText(/✓ A/));
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
  });
});

describe('filterRunLogEvents', () => {
  const events: WorkflowSSEEvent[] = [
    { type: 'run.started', runId: 'r1' },
    { type: 'node.started', nodeId: 'n1', nodeType: 'agent_coding' },
    { type: 'node.progress', nodeId: 'n1', chunk: 'x', accumulated: 'x' },
    { type: 'node.completed', nodeId: 'n1', output: 'ok', durationMs: 10 },
    { type: 'node.failed', nodeId: 'n2', error: 'boom' },
    { type: 'run.failed', runId: 'r1', error: 'fail' },
  ];

  it('filters by chip category', () => {
    expect(filterRunLogEvents(events, 'all')).toHaveLength(6);
    expect(filterRunLogEvents(events, 'progress')).toHaveLength(1);
    expect(filterRunLogEvents(events, 'completed')).toHaveLength(1);
    expect(filterRunLogEvents(events, 'failed')).toHaveLength(2);
    expect(filterRunLogEvents(events, 'lifecycle').map((e) => e.type)).toEqual([
      'run.started',
      'node.started',
      'node.failed',
      'run.failed',
    ]);
  });
});

describe('linkifyText', () => {
  it('wraps http URLs in anchors', () => {
    const nodes = linkifyText('Deployed to vercel: https://example.vercel.app/path');
    const { container } = render(<div>{nodes}</div>);
    const a = container.querySelector('a');
    expect(a).toBeTruthy();
    expect(a?.getAttribute('href')).toBe('https://example.vercel.app/path');
    expect(a?.textContent).toBe('https://example.vercel.app/path');
  });

  it('strips trailing punctuation from href', () => {
    const nodes = linkifyText('see https://example.com/page).');
    const { container } = render(<div>{nodes}</div>);
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com/page');
  });

  it('leaves plain text without links', () => {
    const nodes = linkifyText('no urls here');
    const { container } = render(<div>{nodes}</div>);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('no urls here');
  });
});

describe('RunLogPanel duration and artifact', () => {
  it('shows duration on completed nodes and artifact id on run.completed', () => {
    const events: WorkflowSSEEvent[] = [
      { type: 'node.completed', nodeId: 'n1', output: 'Deployed to vercel: https://x.vercel.app', durationMs: 1500 },
      { type: 'run.completed', runId: 'run-xyz', duration: 2000, artifactId: 'art-abcdef12' },
    ];
    render(<RunLogPanel events={events} nodeLabelMap={{ n1: 'Deploy' }} />);
    expect(screen.getByText(/1\.50s/)).toBeInTheDocument();
    expect(screen.getByText(/artifact art-abcd/i)).toBeInTheDocument();
  });

  it('formats sub-second duration as ms', () => {
    const events: WorkflowSSEEvent[] = [
      { type: 'node.completed', nodeId: 'n1', output: 'ok', durationMs: 42 },
    ];
    render(<RunLogPanel events={events} nodeLabelMap={{ n1: 'Fast' }} />);
    expect(screen.getByText(/42ms/)).toBeInTheDocument();
  });

  it('linkifies deploy URLs when output is expanded', async () => {
    const user = userEvent.setup();
    const events: WorkflowSSEEvent[] = [
      {
        type: 'node.completed',
        nodeId: 'd1',
        output: 'Deployed to vercel: https://proj.vercel.app',
        durationMs: 200,
      },
    ];
    render(<RunLogPanel events={events} nodeLabelMap={{ d1: 'Deploy' }} />);
    await user.click(screen.getByText(/✓ Deploy/));
    const link = screen.getByRole('link', { name: 'https://proj.vercel.app' });
    expect(link).toHaveAttribute('href', 'https://proj.vercel.app');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('RunLogPanel copy', () => {
  it('shows Copy button when output is expanded', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const events: WorkflowSSEEvent[] = [
      { type: 'node.completed', nodeId: 'n1', output: 'hello-out', durationMs: 10 },
    ];
    render(<RunLogPanel events={events} nodeLabelMap={{ n1: 'Node' }} />);
    await user.click(screen.getByText(/✓ Node/));
    await user.click(screen.getByRole('button', { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith('hello-out');
  });
});

