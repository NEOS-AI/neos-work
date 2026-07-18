import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunLogPanel } from './RunLogPanel.js';
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
