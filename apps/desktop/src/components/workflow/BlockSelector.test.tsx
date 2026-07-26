import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockSelector, defaultsForBlock, safeBlockId } from './BlockSelector.js';
import type { WorkflowBlock } from '../../lib/engine.js';

const listBlocks = vi.fn();

vi.mock('../../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: { listBlocks },
  }),
}));

function block(
  partial: Partial<WorkflowBlock> & Pick<WorkflowBlock, 'id' | 'name' | 'domain' | 'category'>,
): WorkflowBlock {
  return {
    description: 'desc',
    isBuiltIn: true,
    implementationType: 'prompt',
    paramDefs: [],
    inputDescription: 'in',
    outputDescription: 'out',
    ...partial,
  };
}

describe('defaultsForBlock', () => {
  it('returns only params that define a default', () => {
    const result = defaultsForBlock(
      block({
        id: 'b1',
        name: 'Test',
        domain: 'general',
        category: 'cat',
        paramDefs: [
          { key: 'url', type: 'string', label: 'URL', default: 'https://example.com' },
          { key: 'count', type: 'number', label: 'Count', default: 3 },
          { key: 'flag', type: 'boolean', label: 'Flag' },
        ],
      }),
    );
    expect(result).toEqual({ url: 'https://example.com', count: 3 });
    expect(result).not.toHaveProperty('flag');
  });

  it('returns empty object when no defaults', () => {
    expect(
      defaultsForBlock(
        block({
          id: 'b1',
          name: 'Test',
          domain: 'general',
          category: 'cat',
          paramDefs: [{ key: 'x', type: 'string', label: 'X' }],
        }),
      ),
    ).toEqual({});
    expect(
      defaultsForBlock(
        block({ id: 'b1', name: 'Test', domain: 'general', category: 'cat', paramDefs: [] }),
      ),
    ).toEqual({});
  });

  it('drops control-char / blank param keys from defaults', () => {
    expect(
      defaultsForBlock(
        block({
          id: 'b1',
          name: 'Test',
          domain: 'general',
          category: 'cat',
          paramDefs: [
            { key: `bad${'\0'}key`, type: 'string', label: 'B', default: 'no' },
            { key: '\nurl', type: 'string', label: 'U', default: 'no' },
            { key: '  ok  ', type: 'string', label: 'O', default: 'yes' },
            { key: '   ', type: 'string', label: 'Blank', default: 'no' },
          ],
        }),
      ),
    ).toEqual({ ok: 'yes' });
  });

  it('includes falsy defaults (0, false, empty string)', () => {
    expect(
      defaultsForBlock(
        block({
          id: 'b1',
          name: 'Test',
          domain: 'general',
          category: 'cat',
          paramDefs: [
            { key: 'n', type: 'number', label: 'N', default: 0 },
            { key: 'b', type: 'boolean', label: 'B', default: false },
            { key: 's', type: 'string', label: 'S', default: '' },
          ],
        }),
      ),
    ).toEqual({ n: 0, b: false, s: '' });
  });
});

describe('safeBlockId', () => {
  it('rejects control-char ids before trim and trims valid ids', () => {
    expect(safeBlockId(`bad${'\0'}id`)).toBe('');
    expect(safeBlockId('\nlead')).toBe('');
    expect(safeBlockId('  pad-id  ')).toBe('pad-id');
    expect(safeBlockId('')).toBe('');
    expect(safeBlockId(null)).toBe('');
    expect(safeBlockId(42)).toBe('');
  });
});

describe('BlockSelector', () => {
  const blocks: WorkflowBlock[] = [
    block({
      id: 'blk-a',
      name: 'Alpha',
      domain: 'coding',
      category: 'util',
      description: 'Alpha block',
      inputDescription: 'code',
      outputDescription: 'result',
      requiredSettings: ['OPENAI_API_KEY'],
    }),
    block({
      id: 'blk-b',
      name: 'Beta',
      domain: 'finance',
      category: 'data',
      description: 'Beta block',
      inputDescription: 'ticker',
      outputDescription: 'price',
    }),
  ];

  beforeEach(() => {
    listBlocks.mockReset();
    listBlocks.mockResolvedValue({ ok: true, data: blocks });
  });

  it('loads and sorts blocks into select options', async () => {
    const onBlocksLoaded = vi.fn();
    render(
      <BlockSelector value="" onChange={() => {}} onBlocksLoaded={onBlocksLoaded} />,
    );

    await waitFor(() => {
      expect(listBlocks).toHaveBeenCalled();
      expect(onBlocksLoaded).toHaveBeenCalled();
    });

    const select = screen.getByRole('combobox');
    const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
    expect(labels.some((t) => t?.includes('Alpha'))).toBe(true);
    expect(labels.some((t) => t?.includes('Beta'))).toBe(true);
  });

  it('shows scrubbed load error when listBlocks fails', async () => {
    listBlocks.mockResolvedValue({
      ok: false,
      error: `blocks${'\n'}down${'\0'}!`,
    });
    render(<BlockSelector value="" onChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('blocks down!')).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('shows selected block details and settings', async () => {
    render(<BlockSelector value="blk-a" onChange={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha block')).toBeInTheDocument();
    });
    expect(screen.getByText(/Input: code/)).toBeInTheDocument();
    expect(screen.getByText(/Output: result/)).toBeInTheDocument();
    expect(screen.getByText(/Settings: OPENAI_API_KEY/)).toBeInTheDocument();
  });

  it('calls onChange with the selected block', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BlockSelector value="" onChange={onChange} />);

    const select = await screen.findByRole('combobox');
    await waitFor(() => {
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });
    await user.selectOptions(select, 'blk-b');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'blk-b', name: 'Beta' }),
    );
  });

  it('calls onChange(null) when clearing selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BlockSelector value="blk-a" onChange={onChange} />);

    const select = await screen.findByRole('combobox');
    await waitFor(() => {
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });
    await user.selectOptions(select, '');
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('omits blocks with control-char ids from select options', async () => {
    listBlocks.mockResolvedValue({
      ok: true,
      data: [
        ...blocks,
        block({
          id: `bad${'\0'}id`,
          name: 'Evil',
          domain: 'general',
          category: 'x',
        }),
        block({
          id: '\nlead',
          name: 'Lead Ctrl',
          domain: 'general',
          category: 'x',
        }),
        block({
          id: '  pad-id  ',
          name: 'Padded',
          domain: 'general',
          category: 'x',
        }),
      ],
    });
    render(<BlockSelector value="" onChange={() => {}} />);
    const select = await screen.findByRole('combobox');
    await waitFor(() => {
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });
    const values = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(values).toContain('blk-a');
    expect(values).toContain('blk-b');
    expect(values).toContain('pad-id');
    expect(values.some((v) => v.includes('\0') || v.includes('\n'))).toBe(false);
    expect(values).not.toContain('lead');
    expect(screen.queryByText(/Evil/)).not.toBeInTheDocument();
  });

  it('selects padded block ids via trimmed option value and emits normalized id', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    listBlocks.mockResolvedValue({
      ok: true,
      data: [
        block({
          id: '  pad-id  ',
          name: 'Padded',
          domain: 'general',
          category: 'x',
          description: 'Padded block',
        }),
      ],
    });
    render(<BlockSelector value="" onChange={onChange} />);
    const select = await screen.findByRole('combobox');
    await waitFor(() => {
      expect(select.querySelectorAll('option').length).toBeGreaterThan(1);
    });
    await user.selectOptions(select, 'pad-id');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pad-id', name: 'Padded' }),
    );
  });

  it('shows details when value is padded but option id is trimmed', async () => {
    listBlocks.mockResolvedValue({
      ok: true,
      data: [
        block({
          id: '  pad-id  ',
          name: 'Padded',
          domain: 'general',
          category: 'x',
          description: 'Padded block',
          inputDescription: 'in',
          outputDescription: 'out',
        }),
      ],
    });
    render(<BlockSelector value="  pad-id  " onChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Padded block')).toBeInTheDocument();
    });
  });

  it('scrubs option labels and filters control-char requiredSettings', async () => {
    listBlocks.mockResolvedValue({
      ok: true,
      data: [
        block({
          id: 'blk-scrub',
          name: 'Alpha' + String.fromCharCode(10) + 'Block',
          domain: 'cod' + String.fromCharCode(0) + 'ing',
          // collapseLines turns embedded LF into space in the option label
          category: 'ut' + String.fromCharCode(10) + 'il',
          description: 'Desc' + String.fromCharCode(0) + 'X' + String.fromCharCode(10) + 'Y',
          inputDescription: 'in' + String.fromCharCode(10) + 'put',
          outputDescription: 'out' + String.fromCharCode(0) + 'put',
          requiredSettings: [
            'OPENAI_API_KEY',
            'bad' + String.fromCharCode(0) + 'key',
            String.fromCharCode(10) + 'lead',
            '  trim-me  ',
            '   ',
          ],
        }),
      ],
    });
    render(<BlockSelector value="blk-scrub" onChange={() => {}} />);

    const select = await screen.findByRole('combobox');
    await waitFor(() => {
      const labels = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
      // domain null-byte stripped; category LF → space; name LF → space
      expect(labels.some((t) => t?.includes('coding / ut il / Alpha Block'))).toBe(true);
    });
    // Raw null bytes never appear in labels or details
    expect(document.body.textContent).not.toContain('\0');
    expect(document.body.textContent).not.toMatch(/Alpha\nBlock/);

    // description: null stripped, newline kept (no collapseLines)
    await waitFor(() => {
      expect(screen.getByText(/DescX/)).toBeInTheDocument();
    });
    // null-byte stripped from description; newline collapsed for input/output
    expect(screen.getByText(/Input:\s*in put/)).toBeInTheDocument();
    expect(screen.getByText(/Output:\s*output/)).toBeInTheDocument();
    // Control-char settings dropped; blank dropped; valid trimmed
    expect(screen.getByText(/Settings:\s*OPENAI_API_KEY, trim-me/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/badkey/);
  });
});
