import { describe, expect, it } from 'vitest';
import { defaultsForBlock } from './BlockSelector.js';
import type { WorkflowBlock } from '../../lib/engine.js';

function block(paramDefs: WorkflowBlock['paramDefs']): WorkflowBlock {
  return {
    id: 'b1',
    name: 'Test',
    domain: 'general',
    category: 'cat',
    description: 'd',
    isBuiltIn: true,
    implementationType: 'prompt',
    paramDefs,
    inputDescription: 'in',
    outputDescription: 'out',
  };
}

describe('defaultsForBlock', () => {
  it('returns only params that define a default', () => {
    const result = defaultsForBlock(
      block([
        { key: 'url', type: 'string', label: 'URL', default: 'https://example.com' },
        { key: 'count', type: 'number', label: 'Count', default: 3 },
        { key: 'flag', type: 'boolean', label: 'Flag' },
      ]),
    );
    expect(result).toEqual({ url: 'https://example.com', count: 3 });
    expect(result).not.toHaveProperty('flag');
  });

  it('returns empty object when no defaults', () => {
    expect(defaultsForBlock(block([{ key: 'x', type: 'string', label: 'X' }]))).toEqual({});
    expect(defaultsForBlock(block([]))).toEqual({});
  });

  it('includes falsy defaults (0, false, empty string)', () => {
    expect(
      defaultsForBlock(
        block([
          { key: 'n', type: 'number', label: 'N', default: 0 },
          { key: 'b', type: 'boolean', label: 'B', default: false },
          { key: 's', type: 'string', label: 'S', default: '' },
        ]),
      ),
    ).toEqual({ n: 0, b: false, s: '' });
  });
});
