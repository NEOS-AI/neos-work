import type { WorkflowBlock } from '../../lib/engine.js';

export type WorkflowValidationSeverity = 'error' | 'warning';

export interface WorkflowValidationIssue {
  code: string;
  severity: WorkflowValidationSeverity;
  nodeId?: string;
  edgeId?: string;
  message: string;
}

interface DraftNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

interface DraftEdge {
  id: string;
  source: string;
  target: string;
}

function hasCycle(nodes: Array<{ id: string }>, edges: Array<{ source: string; target: string }>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) outgoing.set(node.id, []);
  for (const edge of edges) outgoing.get(edge.source)?.push(edge.target);

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const next of outgoing.get(nodeId) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  return nodes.some((node) => visit(node.id));
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

export function validateWorkflowDraft(input: {
  nodes: DraftNode[];
  edges: DraftEdge[];
  blocks: Pick<WorkflowBlock, 'id' | 'paramDefs'>[];
}): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = [];
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  const blockMap = new Map(input.blocks.map((block) => [block.id, block]));

  for (const node of input.nodes) {
    const config = node.config ?? {};

    if (!node.label.trim()) {
      issues.push({
        code: 'missing_node_label',
        severity: 'error',
        nodeId: node.id,
        message: 'Node label is required.',
      });
    }

    if (node.type === 'block') {
      const blockId = config.blockId;
      if (typeof blockId !== 'string' || blockId.length === 0) {
        issues.push({
          code: 'missing_block_id',
          severity: 'error',
          nodeId: node.id,
          message: 'Block node requires a block selection.',
        });
      } else {
        const block = blockMap.get(blockId);
        const params = (config.params ?? {}) as Record<string, unknown>;
        for (const param of block?.paramDefs ?? []) {
          if (param.default === undefined && isBlank(params[param.key])) {
            issues.push({
              code: 'missing_required_block_param',
              severity: 'error',
              nodeId: node.id,
              message: `Block parameter "${param.key}" is required.`,
            });
          }
        }
      }
    }

    if ((node.type === 'agent_finance' || node.type === 'agent_coding') && typeof config.harnessId !== 'string') {
      issues.push({
        code: 'missing_harness_id',
        severity: 'warning',
        nodeId: node.id,
        message: 'Agent node has no harness selected.',
      });
    }

    if (node.type === 'web_search') {
      const hasQuery = typeof config.query === 'string' && config.query.trim().length > 0;
      const hasIncoming = input.edges.some((edge) => edge.target === node.id);
      if (!hasQuery && !hasIncoming) {
        issues.push({
          code: 'missing_search_query',
          severity: 'warning',
          nodeId: node.id,
          message: 'Web Search has no query or upstream input.',
        });
      }
    }

    if (node.type === 'slack_message' && (typeof config.channel !== 'string' || config.channel.trim().length === 0)) {
      issues.push({
        code: 'missing_slack_channel',
        severity: 'error',
        nodeId: node.id,
        message: 'Slack node requires a channel.',
      });
    }
  }

  for (const edge of input.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        code: 'dangling_edge',
        severity: 'error',
        edgeId: edge.id,
        message: 'Edge points to a missing node.',
      });
    }
  }

  if (hasCycle(input.nodes, input.edges)) {
    issues.push({ code: 'cycle', severity: 'error', message: 'Workflow graph contains a cycle.' });
  }
  if (!input.nodes.some((node) => node.type === 'trigger')) {
    issues.push({ code: 'no_trigger', severity: 'warning', message: 'Workflow has no trigger node.' });
  }
  if (!input.nodes.some((node) => node.type === 'output')) {
    issues.push({ code: 'no_output', severity: 'warning', message: 'Workflow has no output node.' });
  }

  return issues;
}
