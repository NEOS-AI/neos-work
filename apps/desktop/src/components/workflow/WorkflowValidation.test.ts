import { describe, it, expect } from 'vitest';
import { summarizeValidationIssues, validateWorkflowDraft } from './WorkflowValidation.js';

const emptyBlocks: never[] = [];

describe('summarizeValidationIssues', () => {
  it('counts errors and warnings', () => {
    expect(
      summarizeValidationIssues([
        { code: 'a', severity: 'error', message: 'e' },
        { code: 'b', severity: 'warning', message: 'w' },
        { code: 'c', severity: 'error', message: 'e2' },
      ]),
    ).toEqual({ total: 3, errors: 2, warnings: 1 });
    expect(summarizeValidationIssues([])).toEqual({ total: 0, errors: 0, warnings: 0 });
  });
});

describe('validateWorkflowDraft', () => {
  it('returns no_trigger warning when no trigger node', () => {
    const issues = validateWorkflowDraft({ nodes: [], edges: [], blocks: emptyBlocks });
    expect(issues.some((i) => i.code === 'no_trigger')).toBe(true);
  });

  it('returns no_output warning when no output node', () => {
    const issues = validateWorkflowDraft({ nodes: [], edges: [], blocks: emptyBlocks });
    expect(issues.some((i) => i.code === 'no_output')).toBe(true);
  });

  it('warns multiple_triggers when more than one trigger exists', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't1', type: 'trigger', label: 'Start A', config: {} },
        { id: 't2', type: 'trigger', label: 'Start B', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'o' },
        { id: 'e2', source: 't2', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'multiple_triggers')).toBe(true);
    expect(issues.some((i) => i.code === 'no_trigger')).toBe(false);
  });

  it('does not warn multiple_triggers for a single trigger', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [{ id: 'e1', source: 't', target: 'o' }],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'multiple_triggers')).toBe(false);
    expect(issues.some((i) => i.code === 'no_trigger')).toBe(false);
  });

  it('accepts gate_and with two upstreams and does not flag underconnected', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'a', type: 'agent_coding', label: 'A', config: { harnessId: 'h1' } },
        { id: 'b', type: 'agent_coding', label: 'B', config: { harnessId: 'h1' } },
        { id: 'and', type: 'gate_and', label: 'AND', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'a' },
        { id: 'e2', source: 't', target: 'b' },
        { id: 'e3', source: 'a', target: 'and' },
        { id: 'e4', source: 'b', target: 'and' },
        { id: 'e5', source: 'and', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'gate_and_underconnected')).toBe(false);
  });

  it('treats gate_or as a parallel join for parallel_missing_join', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'ps', type: 'parallel_start', label: 'Fan-out', config: {} },
        { id: 'a', type: 'agent_coding', label: 'A', config: { harnessId: 'h1' } },
        { id: 'b', type: 'agent_coding', label: 'B', config: { harnessId: 'h1' } },
        { id: 'or', type: 'gate_or', label: 'OR', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'ps' },
        { id: 'e2', source: 'ps', target: 'a' },
        { id: 'e3', source: 'ps', target: 'b' },
        { id: 'e4', source: 'a', target: 'or' },
        { id: 'e5', source: 'b', target: 'or' },
        { id: 'e6', source: 'or', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'parallel_missing_join')).toBe(false);
    expect(issues.some((i) => i.code === 'or_gate_underconnected')).toBe(false);
  });

  it('returns missing_node_label error when label is blank', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: '1', type: 'trigger', label: '  ', config: {} }],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_node_label' && i.nodeId === '1')).toBe(true);
  });

  it('returns duplicate_node_id when two nodes share an id', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 'dup', type: 'trigger', label: 'A', config: {} },
        { id: 'dup', type: 'output', label: 'B', config: {} },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'duplicate_node_id' && i.nodeId === 'dup')).toBe(true);
  });

  it('warns duplicate_node_label when two nodes share a label (case-insensitive)', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'a', type: 'agent_coding', label: 'Worker', config: { harnessId: 'h1' } },
        { id: 'b', type: 'agent_coding', label: '  worker  ', config: { harnessId: 'h1' } },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'a' },
        { id: 'e2', source: 'a', target: 'b' },
        { id: 'e3', source: 'b', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    const dups = issues.filter((i) => i.code === 'duplicate_node_label');
    expect(dups.map((i) => i.nodeId).sort()).toEqual(['a', 'b']);
  });

  it('does not warn duplicate_node_label for blank labels (missing_node_label covers those)', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: '1', type: 'trigger', label: '  ', config: {} },
        { id: '2', type: 'output', label: '', config: {} },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'duplicate_node_label')).toBe(false);
  });

  it('returns missing_block_id error when block node has no blockId', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: 'b1', type: 'block', label: 'My Block', config: {} }],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_block_id' && i.nodeId === 'b1')).toBe(true);
  });

  it('treats whitespace-only blockId as missing', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: 'b1', type: 'block', label: 'My Block', config: { blockId: '   ' } }],
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

  it('flags blank edge endpoints as dangling', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 'a', type: 'trigger', label: 'A', config: {} },
        { id: 'b', type: 'output', label: 'B', config: {} },
      ],
      edges: [{ id: 'e1', source: '  ', target: 'b' }],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'dangling_edge')).toBe(true);
  });

  it('detects self_loop when edge source equals target', () => {
    const issues = validateWorkflowDraft({
      nodes: [{ id: 'n1', type: 'trigger', label: 'T', config: {} }],
      edges: [{ id: 'e1', source: 'n1', target: 'n1' }],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'self_loop')).toBe(true);
  });

  it('detects duplicate_edge when two edges share source and target', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 'a', type: 'trigger', label: 'A', config: {} },
        { id: 'b', type: 'output', label: 'B', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'a', target: 'b' },
      ],
      blocks: emptyBlocks,
    });
    const dups = issues.filter((i) => i.code === 'duplicate_edge');
    expect(dups.length).toBe(2);
    expect(dups.every((i) => i.severity === 'warning')).toBe(true);
  });

  it('detects duplicate_edge_id when two edges share an id', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 'a', type: 'trigger', label: 'A', config: {} },
        { id: 'b', type: 'output', label: 'B', config: {} },
        { id: 'c', type: 'block', label: 'C', config: { blockId: 'x' } },
      ],
      edges: [
        { id: 'same', source: 'a', target: 'b' },
        { id: 'same', source: 'a', target: 'c' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'duplicate_edge_id' && i.edgeId === 'same')).toBe(true);
  });

  it('detects missing_edge_id when edge id is empty or whitespace', () => {
    const empty = validateWorkflowDraft({
      nodes: [
        { id: 'a', type: 'trigger', label: 'A', config: {} },
        { id: 'b', type: 'output', label: 'B', config: {} },
      ],
      edges: [{ id: '', source: 'a', target: 'b' }],
      blocks: emptyBlocks,
    });
    expect(empty.some((i) => i.code === 'missing_edge_id')).toBe(true);

    const blank = validateWorkflowDraft({
      nodes: [
        { id: 'a', type: 'trigger', label: 'A', config: {} },
        { id: 'b', type: 'output', label: 'B', config: {} },
      ],
      edges: [{ id: '   ', source: 'a', target: 'b' }],
      blocks: emptyBlocks,
    });
    expect(blank.some((i) => i.code === 'missing_edge_id')).toBe(true);
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
    expect(issues.some((i) => i.code === 'missing_slack_content' && i.nodeId === 's1')).toBe(true);
  });

  it('warns missing_slack_content when channel set but no template or upstream', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'T', config: {} },
        { id: 's1', type: 'slack_message', label: 'Slack', config: { channel: '#general' } },
        { id: 'o', type: 'output', label: 'O', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_slack_channel')).toBe(false);
    expect(issues.some((i) => i.code === 'missing_slack_content' && i.nodeId === 's1')).toBe(true);
  });

  it('does not warn missing_slack_content when textTemplate is set', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 's1',
          type: 'slack_message',
          label: 'Slack',
          config: { channel: '#general', textTemplate: 'hello {{out}}' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_slack_content')).toBe(false);
  });

  it('does not warn missing_slack_content when upstream is connected', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'T', config: {} },
        { id: 's1', type: 'slack_message', label: 'Slack', config: { channel: '#alerts' } },
        { id: 'o', type: 'output', label: 'O', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 's1' },
        { id: 'e2', source: 's1', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_slack_content')).toBe(false);
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

  it('does not warn discord when textTemplate is set (NodeConfig field)', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'd1',
          type: 'discord_message',
          label: 'Discord',
          config: { textTemplate: 'Hello {{x}}' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_discord_content')).toBe(false);
  });

  it('warns about isolated nodes when graph has multiple nodes', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
        { id: 'x', type: 'agent_coding', label: 'Lonely', config: {} },
      ],
      edges: [{ id: 'e1', source: 't', target: 'o' }],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'isolated_node' && i.nodeId === 'x')).toBe(true);
  });

  it('warns when output has no upstream', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'output_no_upstream' && i.nodeId === 'o')).toBe(true);
  });

  it('warns when trigger has no downstream', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'trigger_no_downstream' && i.nodeId === 't')).toBe(true);
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

describe('validateWorkflowDraft media tts model (v0.3.46)', () => {
  it('warns invalid_media_tts_model for bad audio model', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'audio', text: 'hi', model: 'whisper-1' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'invalid_media_tts_model')).toBe(true);
  });

  it('accepts tts-1 / tts-1-hd and ignores unset model or model on image nodes', () => {
    for (const model of ['tts-1', 'tts-1-hd'] as const) {
      const ok = validateWorkflowDraft({
        nodes: [
          {
            id: 'm',
            type: 'media',
            label: 'M',
            config: { mediaType: 'audio', text: 'hi', model },
          },
        ],
        edges: [],
        blocks: emptyBlocks,
      });
      expect(ok.some((i) => i.code === 'invalid_media_tts_model')).toBe(false);
    }

    const unset = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'audio', text: 'hi' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(unset.some((i) => i.code === 'invalid_media_tts_model')).toBe(false);

    const empty = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'audio', text: 'hi', model: '' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(empty.some((i) => i.code === 'invalid_media_tts_model')).toBe(false);

    const image = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'image', prompt: 'x', model: 'whisper-1' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(image.some((i) => i.code === 'invalid_media_tts_model')).toBe(false);
  });
});

describe('validateWorkflowDraft agent/media/param polish (v0.3.45)', () => {
  it('warns missing_llm_model for non-CLI agents without model', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'a',
          type: 'agent_coding',
          label: 'Agent',
          config: { harnessId: 'h1' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_llm_model' && i.nodeId === 'a')).toBe(true);
  });

  it('does not warn missing_llm_model for CLI agents or when model set', () => {
    for (const llmProvider of ['cli-claude', 'cli-gemini', 'cli-codex']) {
      const cli = validateWorkflowDraft({
        nodes: [
          {
            id: 'a',
            type: 'agent_coding',
            label: 'CLI',
            config: { llmProvider },
          },
        ],
        edges: [],
        blocks: emptyBlocks,
      });
      expect(cli.some((i) => i.code === 'missing_llm_model')).toBe(false);
    }

    const withModel = validateWorkflowDraft({
      nodes: [
        {
          id: 'a',
          type: 'agent_coding',
          label: 'Agent',
          config: { harnessId: 'h1', llmModel: 'claude-sonnet-4' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(withModel.some((i) => i.code === 'missing_llm_model')).toBe(false);

    // Accept legacy `model` alias
    const withAlias = validateWorkflowDraft({
      nodes: [
        {
          id: 'a',
          type: 'agent_finance',
          label: 'Agent',
          config: { harnessId: 'h1', model: 'gpt-4o' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(withAlias.some((i) => i.code === 'missing_llm_model')).toBe(false);
  });

  it('treats whitespace-only llmModel as missing', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'a',
          type: 'agent_coding',
          label: 'Agent',
          config: { harnessId: 'h1', llmModel: '   ' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_llm_model' && i.nodeId === 'a')).toBe(true);
  });

  it('warns invalid_media_quality only for image with bad quality', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'image', prompt: 'x', quality: 'ultra' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'invalid_media_quality')).toBe(true);

    const ok = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'image', prompt: 'x', quality: 'hd' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(ok.some((i) => i.code === 'invalid_media_quality')).toBe(false);

    // quality on audio is ignored
    const audio = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'audio', text: 'hi', quality: 'ultra' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(audio.some((i) => i.code === 'invalid_media_quality')).toBe(false);
  });

  it('treats whitespace-only required block params as missing', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'b',
          type: 'block',
          label: 'B',
          config: { blockId: 'blk1', params: { url: '   ' } },
        },
      ],
      edges: [],
      blocks: [{ id: 'blk1', paramDefs: [{ key: 'url', type: 'string', label: 'URL' }] }],
    });
    expect(issues.some((i) => i.code === 'missing_required_block_param' && i.nodeId === 'b')).toBe(true);

    const filled = validateWorkflowDraft({
      nodes: [
        {
          id: 'b',
          type: 'block',
          label: 'B',
          config: { blockId: 'blk1', params: { url: 'https://example.com' } },
        },
      ],
      edges: [],
      blocks: [{ id: 'blk1', paramDefs: [{ key: 'url', type: 'string', label: 'URL' }] }],
    });
    expect(filled.some((i) => i.code === 'missing_required_block_param')).toBe(false);
  });
});

describe('validateWorkflowDraft parallel/slack polish (v0.3.44)', () => {
  it('warns parallel_missing_start when Parallel End has no Parallel Start', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'T', config: {} },
        { id: 'pe', type: 'parallel_end', label: 'Join', config: {} },
        { id: 'o', type: 'output', label: 'O', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'pe' },
        { id: 'e2', source: 'pe', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'parallel_missing_start')).toBe(true);
  });

  it('does not warn parallel_missing_start when Parallel Start is present', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'T', config: {} },
        { id: 'ps', type: 'parallel_start', label: 'Fan', config: {} },
        { id: 'a', type: 'output', label: 'A', config: {} },
        { id: 'b', type: 'output', label: 'B', config: {} },
        { id: 'pe', type: 'parallel_end', label: 'Join', config: {} },
        { id: 'o', type: 'output', label: 'O', config: {} },
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
    expect(issues.some((i) => i.code === 'parallel_missing_start')).toBe(false);
    expect(issues.some((i) => i.code === 'parallel_missing_join')).toBe(false);
  });

  it('warns slack_content_too_long', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 's',
          type: 'slack_message',
          label: 'S',
          config: { channel: '#x', textTemplate: 'z'.repeat(4001) },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'slack_content_too_long')).toBe(true);
  });

  it('allows slack content at the 4000 limit and checks alternate fields', () => {
    const atLimit = validateWorkflowDraft({
      nodes: [
        {
          id: 's',
          type: 'slack_message',
          label: 'S',
          config: { channel: '#x', textTemplate: 'a'.repeat(4000) },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(atLimit.some((i) => i.code === 'slack_content_too_long')).toBe(false);

    const viaContent = validateWorkflowDraft({
      nodes: [
        {
          id: 's',
          type: 'slack_message',
          label: 'S',
          config: { channel: '#x', textTemplate: '   ', content: 'b'.repeat(4001) },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(viaContent.some((i) => i.code === 'slack_content_too_long')).toBe(true);
  });
});

describe('validateWorkflowDraft media/deploy/discord polish (v0.3.42)', () => {
  it('warns invalid_media_size and invalid_media_voice', () => {
    const size = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'image', prompt: 'x', size: '512x512' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(size.some((i) => i.code === 'invalid_media_size')).toBe(true);

    const voice = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'audio', text: 'hi', voice: 'robot' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(voice.some((i) => i.code === 'invalid_media_voice')).toBe(true);

    const ok = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'image', prompt: 'x', size: '1024x1024' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(ok.some((i) => i.code === 'invalid_media_size')).toBe(false);
  });

  it('does not apply image size rules to audio or unset size', () => {
    const audio = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'audio', text: 'hi', size: '512x512', voice: 'alloy' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(audio.some((i) => i.code === 'invalid_media_size')).toBe(false);

    const unset = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'image', prompt: 'x' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(unset.some((i) => i.code === 'invalid_media_size')).toBe(false);
  });

  it('warns invalid_deploy_project for illegal names', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'd',
          type: 'deploy',
          label: 'D',
          config: { provider: 'vercel', projectName: '-bad name', content: '<html/>' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'invalid_deploy_project')).toBe(true);

    const ok = validateWorkflowDraft({
      nodes: [
        {
          id: 'd',
          type: 'deploy',
          label: 'D',
          config: { provider: 'vercel', projectName: 'neos-app', content: '<html/>' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(ok.some((i) => i.code === 'invalid_deploy_project')).toBe(false);
  });

  it('warns discord_content_too_long only above 2000 chars', () => {
    const long = 'x'.repeat(2001);
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'd',
          type: 'discord_message',
          label: 'D',
          config: { textTemplate: long },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'discord_content_too_long')).toBe(true);

    const atLimit = validateWorkflowDraft({
      nodes: [
        {
          id: 'd',
          type: 'discord_message',
          label: 'D',
          config: { textTemplate: 'x'.repeat(2000) },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(atLimit.some((i) => i.code === 'discord_content_too_long')).toBe(false);
  });

  it('detects long discord content even when textTemplate is blank whitespace', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'd',
          type: 'discord_message',
          label: 'D',
          config: { textTemplate: '   ', content: 'y'.repeat(2001) },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'discord_content_too_long')).toBe(true);
  });
});

describe('validateWorkflowDraft config bounds (v0.3.41)', () => {
  it('warns invalid_web_search_max_results outside 1–20', () => {
    const bad = validateWorkflowDraft({
      nodes: [{ id: 'w', type: 'web_search', label: 'S', config: { query: 'q', maxResults: 50 } }],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(bad.some((i) => i.code === 'invalid_web_search_max_results' && i.nodeId === 'w')).toBe(true);

    const fractional = validateWorkflowDraft({
      nodes: [{ id: 'w', type: 'web_search', label: 'S', config: { query: 'q', maxResults: 2.5 } }],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(fractional.some((i) => i.code === 'invalid_web_search_max_results')).toBe(true);

    const zero = validateWorkflowDraft({
      nodes: [{ id: 'w', type: 'web_search', label: 'S', config: { query: 'q', maxResults: 0 } }],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(zero.some((i) => i.code === 'invalid_web_search_max_results')).toBe(true);

    const ok = validateWorkflowDraft({
      nodes: [{ id: 'w', type: 'web_search', label: 'S', config: { query: 'q', maxResults: 10 } }],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(ok.some((i) => i.code === 'invalid_web_search_max_results')).toBe(false);
  });

  it('errors on invalid_media_type but allows image/audio/empty', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'video', prompt: 'x' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'invalid_media_type' && i.severity === 'error')).toBe(true);

    for (const mediaType of ['image', 'audio', '', undefined, '  Image  ', '  AUDIO  '] as const) {
      const ok = validateWorkflowDraft({
        nodes: [
          {
            id: 'm',
            type: 'media',
            label: 'M',
            config: mediaType === undefined
              ? { prompt: 'x' }
              : { mediaType, prompt: 'x', text: 'tts' },
          },
        ],
        edges: [],
        blocks: emptyBlocks,
      });
      expect(ok.some((i) => i.code === 'invalid_media_type')).toBe(false);
    }
  });

  it('warns when media prompt/text exceeds route length caps', () => {
    const longPrompt = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'image', prompt: 'p'.repeat(4001) },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(longPrompt.some((i) => i.code === 'media_prompt_too_long')).toBe(true);

    const longText = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'M',
          config: { mediaType: 'audio', text: 't'.repeat(4097) },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(longText.some((i) => i.code === 'media_text_too_long')).toBe(true);
  });

  it('warns invalid_agent_max_steps when non-positive, non-integer, or above 200', () => {
    const zero = validateWorkflowDraft({
      nodes: [
        {
          id: 'a',
          type: 'agent_coding',
          label: 'Agent',
          config: { harnessId: 'h1', maxSteps: 0 },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(zero.some((i) => i.code === 'invalid_agent_max_steps' && i.nodeId === 'a')).toBe(true);

    const fractional = validateWorkflowDraft({
      nodes: [
        {
          id: 'a',
          type: 'agent_finance',
          label: 'Agent',
          config: { harnessId: 'h1', maxSteps: 1.5 },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(fractional.some((i) => i.code === 'invalid_agent_max_steps')).toBe(true);

    const tooHigh = validateWorkflowDraft({
      nodes: [
        {
          id: 'a',
          type: 'agent_coding',
          label: 'Agent',
          config: { harnessId: 'h1', maxSteps: 201 },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(tooHigh.some((i) => i.code === 'invalid_agent_max_steps')).toBe(true);

    // String form still validated via Number()
    const stringHigh = validateWorkflowDraft({
      nodes: [
        {
          id: 'a',
          type: 'agent_coding',
          label: 'Agent',
          config: { harnessId: 'h1', maxSteps: '500' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(stringHigh.some((i) => i.code === 'invalid_agent_max_steps')).toBe(true);

    const ok = validateWorkflowDraft({
      nodes: [
        {
          id: 'a',
          type: 'agent_coding',
          label: 'Agent',
          config: { harnessId: 'h1', maxSteps: 8 },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(ok.some((i) => i.code === 'invalid_agent_max_steps')).toBe(false);

    const atCap = validateWorkflowDraft({
      nodes: [
        {
          id: 'a',
          type: 'agent_coding',
          label: 'Agent',
          config: { harnessId: 'h1', maxSteps: 200 },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(atCap.some((i) => i.code === 'invalid_agent_max_steps')).toBe(false);

    // Unset maxSteps is allowed (runtime default applies)
    const unset = validateWorkflowDraft({
      nodes: [
        {
          id: 'a',
          type: 'agent_coding',
          label: 'Agent',
          config: { harnessId: 'h1' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(unset.some((i) => i.code === 'invalid_agent_max_steps')).toBe(false);
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

  it('warns when media audio has no text or upstream', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'm', type: 'media', label: 'TTS', config: { mediaType: 'audio' } },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [{ id: 'e2', source: 'm', target: 'o' }],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_media_prompt' && i.nodeId === 'm')).toBe(true);
  });

  it('does not warn media audio when text is set', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'm',
          type: 'media',
          label: 'TTS',
          config: { mediaType: 'audio', text: 'hello' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_media_prompt')).toBe(false);
  });

  it('warns multiple_outputs when more than one output exists', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'o1', type: 'output', label: 'End A', config: {} },
        { id: 'o2', type: 'output', label: 'End B', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'o1' },
        { id: 'e2', source: 't', target: 'o2' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'multiple_outputs')).toBe(true);
    expect(issues.some((i) => i.code === 'no_output')).toBe(false);
  });

  it('does not warn multiple_outputs for a single output', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [{ id: 'e1', source: 't', target: 'o' }],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'multiple_outputs')).toBe(false);
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

  it('warns when gate_or (palette alias) is underconnected', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'or', type: 'gate_or', label: 'OR', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'or' },
        { id: 'e2', source: 'or', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'or_gate_underconnected' && i.nodeId === 'or')).toBe(true);
  });

  it('warns when gate_and has fewer than two predecessors', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        { id: 'and', type: 'gate_and', label: 'AND', config: {} },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'and' },
        { id: 'e2', source: 'and', target: 'o' },
      ],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'gate_and_underconnected' && i.nodeId === 'and')).toBe(true);
  });

  it('warns block_no_upstream when block is disconnected in multi-node graph', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'T', config: {} },
        { id: 'b', type: 'block', label: 'Block', config: { blockId: 'blk1' } },
        { id: 'o', type: 'output', label: 'O', config: {} },
      ],
      edges: [{ id: 'e1', source: 't', target: 'o' }],
      blocks: [{ id: 'blk1', paramDefs: [] }],
    });
    expect(issues.some((i) => i.code === 'block_no_upstream' && i.nodeId === 'b')).toBe(true);
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

    const padded = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'Start', config: {} },
        {
          id: 'a',
          type: 'agent_coding',
          label: 'CLI',
          config: { provider: '  CLI-Claude  ' },
        },
        { id: 'o', type: 'output', label: 'End', config: {} },
      ],
      edges: [
        { id: 'e1', source: 't', target: 'a' },
        { id: 'e2', source: 'a', target: 'o' },
      ],
      blocks: [],
    });
    expect(padded.some((i) => i.code === 'missing_harness_id')).toBe(false);
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

  it('warns missing_harness_id for empty or whitespace harnessId', () => {
    for (const harnessId of ['', '   ']) {
      const issues = validateWorkflowDraft({
        nodes: [
          {
            id: 'a',
            type: 'agent_coding',
            label: 'Agent',
            config: { harnessId },
          },
        ],
        edges: [],
        blocks: [],
      });
      expect(issues.some((i) => i.code === 'missing_harness_id' && i.nodeId === 'a')).toBe(true);
    }
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
          config: { provider: 'vercel', projectName: 'site', content: '<html></html>' },
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

  it('warns missing_deploy_project when projectName is blank', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'd',
          type: 'deploy',
          label: 'Deploy',
          config: { provider: 'vercel', content: '<html></html>' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_deploy_project' && i.nodeId === 'd')).toBe(true);
  });

  it('does not warn missing_deploy_project when projectName is set', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        {
          id: 'd',
          type: 'deploy',
          label: 'Deploy',
          config: { provider: 'cloudflare', projectName: 'my-site', content: 'x' },
        },
      ],
      edges: [],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'missing_deploy_project')).toBe(false);
  });

  it('warns agent_no_upstream when agent is disconnected in multi-node graph', () => {
    const issues = validateWorkflowDraft({
      nodes: [
        { id: 't', type: 'trigger', label: 'T', config: {} },
        { id: 'a', type: 'agent_coding', label: 'Agent', config: { harnessId: 'h1' } },
        { id: 'o', type: 'output', label: 'O', config: {} },
      ],
      edges: [{ id: 'e1', source: 't', target: 'o' }],
      blocks: emptyBlocks,
    });
    expect(issues.some((i) => i.code === 'agent_no_upstream' && i.nodeId === 'a')).toBe(true);
  });
});


