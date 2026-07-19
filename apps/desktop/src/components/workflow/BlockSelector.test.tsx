import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockSelector, defaultsForBlock } from './BlockSelector.js';
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
});
