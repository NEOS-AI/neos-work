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

  it('returns missing_discord_content when discord has no content or upstream', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: 'd1', type: 'discord_message', label: 'Discord', config: {} }],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_discord_content' && i.nodeId === 'd1')).toBe(true);
  });

  it('does not warn discord when static content is set', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: 'd1', type: 'discord_message', label: 'Discord', config: { content: 'hi' } }],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_discord_content')).toBe(false);
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

describe('validateWorkflowDraft media/deploy nodes', () => {
  it('does not require blockId for media or deploy nodes', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'm', type: 'media', label: 'Media', config: { mediaType: 'image' } },
        { id: 'd', type: 'deploy', label: 'Deploy', config: { provider: 'vercel' } },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'm' },
        { id: 'e2', source: 'm', target: 'd' },
        { id: 'e3', source: 'd', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_block_id')).toBe(false);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('errors when deploy provider is missing', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'd', type: 'deploy', label: 'Deploy', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'd' },
        { id: 'e2', source: 'd', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_deploy_provider')).toBe(true);
  });

  it('warns when media has no prompt or upstream', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'm', type: 'media', label: 'Media', config: { mediaType: 'image' } },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        // media disconnected from trigger
        { id: 'e2', source: 'm', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_media_prompt')).toBe(true);
  });
});

describe('validateWorkflowDraft parallel / OR gates', () => {
  it('warns when parallel_start lacks a join and underconnected', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'ps', type: 'parallel_start', label: 'Fan-out', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'ps' },
        { id: 'e2', source: 'ps', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'parallel_missing_join')).toBe(true);
    expect(issues.some((i) => i.code === 'parallel_start_underconnected')).toBe(true);
  });

  it('warns when or_gate has fewer than two predecessors', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'or', type: 'or_gate', label: 'Race', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'or' },
        { id: 'e2', source: 'or', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'or_gate_underconnected')).toBe(true);
  });

  it('accepts parallel_start with two branches and parallel_end', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'ps', type: 'parallel_start', label: 'Fan-out', config: {} },
        { id: 'a', type: 'agent_coding', label: 'A', config: { harnessId: 'h1' } },
        { id: 'b', type: 'agent_coding', label: 'B', config: { harnessId: 'h1' } },
        { id: 'pe', type: 'parallel_end', label: 'Join', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'ps' },
        { id: 'e2', source: 'ps', target: 'a' },
        { id: 'e3', source: 'ps', target: 'b' },
        { id: 'e4', source: 'a', target: 'pe' },
        { id: 'e5', source: 'b', target: 'pe' },
        { id: 'e6', source: 'pe', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'parallel_missing_join')).toBe(false);
    expect(issues.some((i) => i.code === 'parallel_start_underconnected')).toBe(false);
    expect(issues.some((i) => i.code === 'parallel_end_underconnected')).toBe(false);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('validateWorkflowDraft agent CLI and deploy content', () => {
  it('does not warn missing harness for cli providers', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        {
          id: 'a',
          type: 'agent_coding',
          label: 'CLI',
          config: { provider: 'cli-claude' },
        },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'a' },
        { id: 'e2', source: 'a', target: 'o' },
      ],
      blocks: [],
    });
    expect(issues.some((i) => i.code === 'missing_harness_id')).toBe(false);
  });

  it('also recognizes llmProvider for CLI harness skip', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        {
          id: 'a',
          type: 'agent_coding',
          label: 'CLI',
          config: { llmProvider: 'cli-codex' },
        },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'a' },
        { id: 'e2', source: 'a', target: 'o' },
      ],
      blocks: [],
    });
    expect(issues.some((i) => i.code === 'missing_harness_id')).toBe(false);
  });

  it('still warns harness for non-CLI agents', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'a', type: 'agent_finance', label: 'Agent', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'a' },
        { id: 'e2', source: 'a', target: 'o' },
      ],
      blocks: [],
    });
    expect(issues.some((i) => i.code === 'missing_harness_id')).toBe(true);
  });

  it('warns when deploy has no content or upstream', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'd', type: 'deploy', label: 'Deploy', config: { provider: 'vercel' } },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        // deploy disconnected from trigger
        { id: 'e2', source: 'd', target: 'o' },
      ],
      blocks: [],
    });
    expect(issues.some((i) => i.code === 'missing_deploy_content')).toBe(true);
  });

  it('does not warn deploy content when config.content is set', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        {
          id: 'd',
          type: 'deploy',
          label: 'Deploy',
          config: { provider: 'vercel', content: '<html></html>' },
        },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'd' },
        { id: 'e2', source: 'd', target: 'o' },
      ],
      blocks: [],
    });
    expect(issues.some((i) => i.code === 'missing_deploy_content')).toBe(false);
  });
});

