import { describe, it, expect } from 'vitest';
import { validateWorkflowDraft } from './WorkflowValidation.js';

const emptyBlocks: never[] = [];

describe('validateWorkflowDraft', () => {
  it('returns no_trigger warning when no trigger node', () => {
    const issues = validateWorkflowDraft({ nodes: [], edges: [], blocks: emptyBlocks });
    expect(issues.some((i) => i.code === 'no_trigger')).toBe(true);
  });

  it('returns no_output warning when no output node', () => {
    const issues = validateWorkflowDraft({ nodes: [], edges: [], blocks: emptyBlocks });
    expect(issues.some((i) => i.code === 'no_output')).toBe(true);
  });

  it('returns missing_node_label error when label is blank', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: '1', type: 'trigger', label: '  ', config: {} }],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_node_label' && i.nodeId === '1')).toBe(true);
  });

  it('returns missing_block_id error when block node has no blockId', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: 'b1', type: 'block', label: 'My Block', config: {} }],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_block_id' && i.nodeId === 'b1')).toBe(true);
  });

  it('returns missing_required_block_param when required param is blank', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: 'b1', type: 'block', label: 'My Block', config: { blockId: 'blk1', params: {} } }],
      edges: [],
      blocks: [{ id: 'blk1', paramDefs: [{ key: 'url', type: 'string', label: 'URL' }] }],
    });
    expect(issues.some((i) => i.code === 'missing_required_block_param' && i.nodeId === 'b1')).toBe(true);
  });

  it('does not return missing_required_block_param when param has default', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: 'b1', type: 'block', label: 'My Block', config: { blockId: 'blk1', params: {} } }],
      edges: [],
      blocks: [{ id: 'blk1', paramDefs: [{ key: 'url', type: 'string', label: 'URL', default: 'https://example.com' }] }],
    });
    expect(issues.some((i) => i.code === 'missing_required_block_param')).toBe(false);
  });

  it('detects dangling edge pointing to missing node', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: 'n1', type: 'trigger', label: 'T', config: {} }],
      edges: [{ id: 'e1', source: 'n1', target: 'n_missing' }],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'dangling_edge')).toBe(true);
  });

  it('detects cycle in graph', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 'a', type: 'block', label: 'A', config: { blockId: 'x' } },
        { id: 'b', type: 'block', label: 'B', config: { blockId: 'x' } },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'cycle')).toBe(true);
  });

  it('returns missing_slack_channel for slack node without channel', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: 's1', type: 'slack_message', label: 'Slack', config: {} }],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_slack_channel' && i.nodeId === 's1')).toBe(true);
  });

  it('passes with valid trigger-output graph', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [{ id: 'e1', source: 't', target: 'o' }],
      blocks: emptyBlocks,
    });
    // Only warnings about no_trigger and no_output should be absent
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(issues.some((i) => i.code === 'no_trigger')).toBe(false);
    expect(issues.some((i) => i.code === 'no_output')).toBe(false);
  });
});

describe('validateWorkflowDraft happy paths', () => {
  it('accepts a minimal valid trigger → output graph', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [{ id: 'e1', source: 't', target: 'o' }],
      blocks: emptyBlocks,
    });
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('accepts block with required params filled', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        {
          id: 'b',
          type: 'block',
          label: 'Lookup',
          config: { blockId: 'blk1', params: { url: 'https://example.com' } },
        },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'b' },
        { id: 'e2', source: 'b', target: 'o' },
      ],
      blocks: [{ id: 'blk1', paramDefs: [{ key: 'url', type: 'string', label: 'URL' }] }],
    });
    expect(issues.some((i) => i.code === 'missing_required_block_param')).toBe(false);
    expect(issues.some((i) => i.code === 'missing_block_id')).toBe(false);
  });
});
