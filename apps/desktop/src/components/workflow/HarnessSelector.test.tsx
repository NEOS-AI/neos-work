import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HarnessSelector } from './HarnessSelector.js';
import type { AgentHarness } from '../../lib/engine.js';

const listHarnesses = vi.fn();

vi.mock('../../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: { listHarnesses },
  }),
}));

const harnesses: AgentHarness[] = [
  {
    id: 'h-code',
    name: 'Coder',
    domain: 'coding',
    description: 'Coding agent harness',
    systemPrompt: 'you code',
    allowedTools: ['shell', 'read'],
    constraints: { maxSteps: 10, timeoutMs: 30_000 },
    isBuiltIn: true,
  },
  {
    id: 'h-fin',
    name: 'Trader',
    domain: 'finance',
    description: 'Finance harness',
    systemPrompt: 'you trade',
    allowedTools: [],
    isBuiltIn: true,
  },
  {
    id: 'h-gen',
    name: 'Generalist',
    domain: 'general',
    description: 'General harness',
    systemPrompt: 'hi',
    allowedTools: ['web'],
    isBuiltIn: false,
  },
];

describe('HarnessSelector', () => {
  beforeEach(() => {
    listHarnesses.mockReset();
    listHarnesses.mockResolvedValue({ ok: true, data: harnesses });
  });

  it('loads harnesses and filters by agent_coding node type', async () => {
    render(
      <HarnessSelector nodeType="agent_coding" value="" onChange={() => {}} />,
    );

    await waitFor(() => {
      expect(listHarnesses).toHaveBeenCalled();
    });

    const select = await screen.findByRole('combobox');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(options.some((t) => t?.includes('Coder'))).toBe(true);
    expect(options.some((t) => t?.includes('Generalist'))).toBe(true);
    expect(options.some((t) => t?.includes('Trader'))).toBe(false);
  });

  it('filters finance domain for agent_finance', async () => {
    render(
      <HarnessSelector nodeType="agent_finance" value="" onChange={() => {}} />,
    );

    const select = await screen.findByRole('combobox');
    await waitFor(() => {
      const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
      expect(options.some((t) => t?.includes('Trader'))).toBe(true);
      expect(options.some((t) => t?.includes('Coder'))).toBe(false);
    });
  });

  it('shows selected harness details including tools and constraints', async () => {
    render(
      <HarnessSelector nodeType="agent_coding" value="h-code" onChange={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Coding agent harness')).toBeInTheDocument();
    });
    expect(screen.getByText(/Tools: shell, read/)).toBeInTheDocument();
    expect(screen.getByText(/max steps 10/)).toBeInTheDocument();
    expect(screen.getByText(/timeout 30000ms/)).toBeInTheDocument();
  });

  it('shows None tools when allowedTools is empty', async () => {
    render(
      <HarnessSelector nodeType="agent_finance" value="h-fin" onChange={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText('Finance harness')).toBeInTheDocument();
    });
    expect(screen.getByText(/Tools: None/)).toBeInTheDocument();
  });

  it('calls onChange when a harness is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <HarnessSelector nodeType="agent_coding" value="" onChange={onChange} />,
    );

    const select = await screen.findByRole('combobox');
    await waitFor(() => {
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });
    await user.selectOptions(select, 'h-code');
    expect(onChange).toHaveBeenCalledWith('h-code');
  });

  it('tolerates listHarnesses failure without crashing', async () => {
    listHarnesses.mockResolvedValue({ ok: false, error: 'boom' });
    render(
      <HarnessSelector nodeType="agent_coding" value="" onChange={() => {}} />,
    );
    await waitFor(() => expect(listHarnesses).toHaveBeenCalled());
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
