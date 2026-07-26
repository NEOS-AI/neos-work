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

  it('shows scrubbed load error when listHarnesses fails', async () => {
    listHarnesses.mockResolvedValue({
      ok: false,
      error: `harness${'\n'}down${'\0'}!`,
    });
    render(
      <HarnessSelector nodeType="agent_coding" value="" onChange={() => {}} />,
    );
    await waitFor(() => expect(listHarnesses).toHaveBeenCalled());
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('harness down!')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('omits control-char harness ids from options and trims padded value match', async () => {
    listHarnesses.mockResolvedValue({
      ok: true,
      data: [
        ...harnesses,
        {
          id: `\nbad-id`,
          name: 'Evil',
          domain: 'coding',
          description: 'should not show',
          systemPrompt: 'x',
          allowedTools: [],
          isBuiltIn: false,
        },
        {
          id: '  pad-h  ',
          name: 'Padded',
          domain: 'coding',
          description: 'Padded harness details',
          systemPrompt: 'x',
          allowedTools: ['read'],
          isBuiltIn: false,
        },
      ],
    });

    render(
      <HarnessSelector nodeType="agent_coding" value="  pad-h  " onChange={() => {}} />,
    );

    const select = await screen.findByRole('combobox');
    await waitFor(() => {
      expect(screen.getByText('Padded harness details')).toBeInTheDocument();
    });
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(values).toContain('pad-h');
    expect(values).not.toContain('bad-id');
    expect(values).not.toContain('\nbad-id');
    expect(screen.queryByText(/Evil/)).not.toBeInTheDocument();
  });

  it('scrubs description and filters control-char tools from details', async () => {
    // filterAndSortHarnesses drops control-char id/name/domain; residual scrub is description + tools
    listHarnesses.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'h-scrub',
          name: 'ScrubCoder',
          domain: 'coding',
          description: 'Agent' + String.fromCharCode(0) + ' harness' + String.fromCharCode(10) + 'details',
          systemPrompt: 'x',
          allowedTools: [
            'shell',
            'bad' + String.fromCharCode(0) + 'tool',
            String.fromCharCode(10) + 'lead',
            '  read  ',
            '   ',
          ],
          constraints: { maxSteps: 5, timeoutMs: 1000 },
          isBuiltIn: false,
        },
      ],
    });

    render(
      <HarnessSelector nodeType="agent_coding" value="h-scrub" onChange={() => {}} />,
    );

    const select = await screen.findByRole('combobox');
    await waitFor(() => {
      const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
      expect(labels.some((t) => t?.includes('ScrubCoder (coding)'))).toBe(true);
    });
    expect(document.body.textContent).not.toContain('\0');

    // description: null stripped, newline retained (no collapseLines on description)
    await waitFor(() => {
      expect(screen.getByText(/Agent harness/)).toBeInTheDocument();
    });
    // Control-char / blank tools dropped; valid tools trimmed
    expect(screen.getByText(/Tools:\s*shell, read/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/badtool/);
  });
});
